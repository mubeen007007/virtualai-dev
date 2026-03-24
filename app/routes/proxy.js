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

async function validateUserPhotoOnServer(file) {
  const arrayBuffer = await file.arrayBuffer();
  const image = sharp(Buffer.from(arrayBuffer), { failOn: "none" }).rotate();

  const metadata = await image.metadata();
  const stats = await image.stats();

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const sizeMb = file.size / (1024 * 1024);
  const aspectRatio = width && height ? width / height : 0;

  const meanR = stats.channels?.[0]?.mean || 0;
  const meanG = stats.channels?.[1]?.mean || 0;
  const meanB = stats.channels?.[2]?.mean || 0;
  const brightness = (meanR + meanG + meanB) / 3;

  if (!file.type.startsWith("image/")) {
    return "Please upload an image file.";
  }

  if (sizeMb > 10) {
    return "Image is too large. Please upload an image under 10MB.";
  }

  if (width < 900 || height < 1200) {
    return "Image is too small. Please upload a clearer, higher-resolution photo.";
  }

  if (width >= height) {
    return "Please upload a portrait photo, not a landscape image.";
  }

  if (aspectRatio < 0.5 || aspectRatio > 0.85) {
    return "Please upload a straight portrait photo with full body visible.";
  }

  if (brightness < 55) {
    return "Image is too dark. Please upload a brighter photo.";
  }

  if (brightness > 245) {
    return "Image is too washed out. Please upload a photo with normal lighting.";
  }

  return null;
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

    const serverValidationError = await validateUserPhotoOnServer(userImage);
    if (serverValidationError) {
      return Response.json(
        { error: serverValidationError },
        { status: 400 },
      );
    }

    const processedUserImage = await fileToLightProcessedDataUri(userImage);
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