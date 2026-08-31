export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const path = incoming.pathname === "/" ? "/index.html" : incoming.pathname;
    const target = new URL("/mbooks" + path + incoming.search, "https://marcuswongjw.github.io");
    return fetch(target, {
      method: request.method,
      redirect: "follow",
    });
  },
};
