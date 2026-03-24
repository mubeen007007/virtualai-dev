import { fal } from "@fal-ai/client";
import { authenticate } from "../shopify.server";

fal.config({
  credentials: process.env.FAL_KEY,
});

function fileToDataUri(file) {
  return file.arrayBuffer().then((buffer) => {
    const base64 = Buffer.from(buffer).toString("base64");
    const mime = file.type || "image/jpeg";
    return `data:${mime};base64,${base64}`;
  });
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);

  return Response.json({
    message: "Try-on proxy is alive",
  });
};

export const action = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const formData = await request.formData();
    const userImage = formData.get("userImage");
    let productImage = formData.get("productImage");

    if (!userImage || !productImage) {
      return Response.json(
        { error: "userImage and productImage are required" },
        { status: 400 },
      );
    }

    if (!process.env.FAL_KEY) {
      return Response.json(
        { error: "FAL_KEY is missing on the server" },
        { status: 500 },
      );
    }

    const modelImageDataUri = await fileToDataUri(userImage);
    productImage = normalizeImageUrl(productImage);

    const result = await fal.subscribe("fal-ai/fashn/tryon/v1.6", {
      input: {
        model_image: modelImageDataUri,
        garment_image: productImage,
        category: "auto",
        mode: "quality",
        garment_photo_type: "model",
        moderation_level: "permissive",
        num_samples: 3,
        segmentation_free: false,
        output_format: "png",
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(log.message));
        }
      },
    });

    const outputImages = result?.data?.images || [];
    const outputImage = outputImages[0]?.url;

    if (!outputImage) {
      return Response.json(
        {
          success: false,
          error: "fal.ai did not return an output image",
          raw: result?.data || null,
        },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      message: "Try-on generated successfully",
      resultImage: outputImage,
      allResultImages: outputImages.map((img) => img.url),
      uploadedFileName: userImage?.name || "unknown-file",
      productImageUsed: productImage,
    });
  } catch (error) {
    console.error("PROXY TRYON ERROR:", error);

    return Response.json(
      {
        success: false,
        error: error?.message || "Something went wrong",
      },
      { status: 500 },
    );
  }
};