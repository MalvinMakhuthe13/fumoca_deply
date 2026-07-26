// cloudflare/workers/r2-storage.js
var r2_storage_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
        }
      });
    }
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "fumoca-r2",
        version: "2.0"
      });
    }
    return Response.json({
      error: "Not Found"
    }, { status: 404 });
  }
};
export {
  r2_storage_default as default
};
//# sourceMappingURL=r2-storage.js.map
