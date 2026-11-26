const SERVICE = "relaton-mcp";

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") {
      return Response.json({ status: "ok", service: SERVICE });
    }
    return new Response("not found\n", { status: 404 });
  },
};
