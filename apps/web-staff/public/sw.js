self.addEventListener("push", event => {
  const data = event.data ? event.data.json() : { title: "The Vedanta", body: "New house message" };
  event.waitUntil(self.registration.showNotification(data.title || "The Vedanta", { body: data.body || "" }));
});
