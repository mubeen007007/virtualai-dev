export const action = async ({ request }) => {
  try {
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

    return Response.json({
      success: true,
      message: "Backend route is working",
      productImage,
      uploadedFileName: userImage?.name || "unknown-file",
    });
  } catch (error) {
    console.error("TRYON API ERROR:", error);

    return Response.json(
      {
        success: false,
        error: error?.message || "Something went wrong",
      },
      { status: 500 },
    );
  }
};

export const loader = async () => {
  return Response.json({ message: "Try-on API is alive" });
};