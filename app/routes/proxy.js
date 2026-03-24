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

async function fileToProcessedDataUri(file, options = {}) {
  const {
    width = 1024,
    height = 1536,
    fit = "contain",
    background = { r: 255, g: 255, b: 255, alpha: 1 },
    png = true,
    sharpen = true,
    normalize = true,
  } = options;

  const arrayBuffer = await file.arrayBuffer();
  let image = sharp(Buffer.from(arrayBuffer), { failOn: "none" }).rotate();

  if (normalize) image = image.normalize();
  if (sharpen) image = image.sharpen();

  image = image.resize(width, height, {
    fit,
    background,
    withoutEnlargement: true,
  });

  const outputBuffer = png
    ? await image.png({ compressionLevel: 9 }).toBuffer()
    : await image.jpeg({ quality: 92 }).toBuffer();

  const mime = png ? "image/png" : "image/jpeg";
  const base64 = outputBuffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

async function urlImageToProcessedDataUri(url, options = {}) {
  const normalizedUrl = normalizeImageUrl(url);
  const response = await fetch(normalizedUrl);

  if (!response.ok) {
    throw new Error(`Failed to download garment image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  const {
    width = 1024,
    height = 1536,
    fit = "contain",
    background = { r: 255, g: 255, b: 255, alpha: 1 },
    png = true,
    sharpen = true,
    normalize = true,
  } = options;

  let image = sharp(Buffer.from(arrayBuffer), { failOn: "none" }).rotate();

  if (normalize) image = image.normalize();
  if (sharpen) image = image.sharpen();

  image = image.resize(width, height, {
    fit,
    background,
    withoutEnlargement: true,
  });

  const outputBuffer = png
    ? await image.png({ compressionLevel: 9 }).toBuffer()
    : await image.jpeg({ quality: 92 }).toBuffer();

  const mime = png ? "image/png" : "image/jpeg";
  const base64 = outputBuffer.toString("base64");
  return `data:${mime};base64,${base64}`;
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
    const productImage = formData.get("productImage");

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

    // USER IMAGE PREPROCESSING:
    // - auto rotate
    // - normalize brightness/contrast
    // - sharpen slightly
    // - resize to a stable portrait canvas
    const processedUserImage = await fileToProcessedDataUri(userImage, {
      width: 1024,
      height: 1536,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      png: true,
      sharpen: true,
      normalize: true,
    });

    // GARMENT IMAGE PREPROCESSING:
    // - fetch from Shopify
    // - auto rotate
    // - normalize brightness/contrast
    // - sharpen slightly
    // - resize to stable canvas
    // - convert to data URI so fal gets a clean valid image input
    const processedGarmentImage = await urlImageToProcessedDataUri(productImage, {
      width: 1024,
      height: 1536,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      png: true,
      sharpen: true,
      normalize: true,
    });

    const result = await fal.subscribe("fal-ai/fashn/tryon/v1.6", {
      input: {
        model_image: processedUserImage,
        garment_image: processedGarmentImage,
        category: "auto",
        mode: "quality",
        garment_photo_type: "model",
        moderation_level: "permissive",
        num_samples: 1,
        segmentation_free: false,
        sync_mode: true,
        output_format: "png",
        seed: 42,
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