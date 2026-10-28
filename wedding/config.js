// Public settings only. Service-account credentials belong in Worker secrets.
export const config = {
  apiBase: "https://becky-alex-wedding-rsvp.alex-db2.workers.dev",
  googleMapsApiKey: "", // Restrict to w5y.me + Maps JavaScript API / Places API (New).
  photos: {
    lake: new URL('./assets/images/header.jpeg', import.meta.url).href,
    couple: new URL('./assets/images/thank you.jpeg', import.meta.url).href,
  },
  messages: {
    yes: {
      title: "We can’t wait to celebrate with you.",
      body: "Thank you for saving our date. We’ll send your invitation a little closer to the day. Until then, lots of love.",
    },
    no: {
      title: "You’ll be missed.",
      body: "Thank you for letting us know. We’ll be thinking of you on the day, and hope to celebrate together another time. Lots of love.",
    },
  },
};
