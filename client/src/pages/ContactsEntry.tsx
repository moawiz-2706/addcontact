import { useEffect } from "react";

export default function ContactsEntry() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const locationId = params.get("locationId");
      const target = new URL(window.location.origin + "/");
      if (locationId) target.searchParams.set("locationId", locationId);
      target.searchParams.set("view", "contacts");
      // navigate to root with view=contacts
      window.location.replace(target.toString());
    } catch (err) {
      // fallback: go to root
      window.location.replace("/?view=contacts");
    }
  }, []);

  return null;
}
