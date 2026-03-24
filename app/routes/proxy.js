import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { authenticate } from "../shopify.server";

fal.config({
  credentials: process.env.FAL_KEY,
});

function normalizeImageUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

async function fileToLightProcessedDataUri(file) {
  const arrayBuffer = await file.arrayBuffer();

  const outputBuffer = await sharp(Buffer.from(arrayBuffer), { failOn: "none" })
    .rotate()
    .resize({
      width: 1200,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 95 })
    .toBuffer();

  const base64 = outputBuffer.toString("base64");
  return `data:image/jpeg;base64,${base64}`;
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

    // Very light processing only on the user image
    const processedUserImage = await fileToLightProcessedDataUri(userImage);

    // Do NOT preprocess the garment image
    productImage = normalizeImageUrl(productImage);

    const result = await fal.subscribe("fal-ai/fashn/tryon/v1.6", {
      input: {
        model_image: processedUserImage,
        garment_image: productImage,
        category: "auto",
        mode: "quality",
        garment_photo_type: "model",
        moderation_level: "permissive",
        num_samples: 1,
        segmentation_free: true,
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