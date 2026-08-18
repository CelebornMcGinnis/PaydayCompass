import { useEffect, useState } from "react";
import { preferencesApi } from "./apiClient";

// Category names typed inline via "+ Add new category" (Add Expense, Mass
// Add, Planned Expenses, Recurring) previously only ever updated that
// page's own local dropdown state - a category typed on one page (or even
// the same page after a reload) vanished everywhere else, since nothing
// persisted it anywhere. Stored in user_preferences as a real, shared
// source of truth every category dropdown in the app merges in.
export function useCustomCategories() {
  const [customCategories, setCustomCategories] = useState([]);

  useEffect(() => {
    preferencesApi
      .get()
      .then((prefs) => setCustomCategories(prefs.customCategories || []))
      .catch(() => {}); // best-effort - the page's own base category list still works without this
  }, []);

  function addCustomCategory(name) {
    setCustomCategories((current) => {
      if (current.includes(name)) return current;
      const next = [...current, name];
      preferencesApi.update({ customCategories: next }).catch(() => {}); // best-effort - the category is still usable locally this session even if the persist call fails
      return next;
    });
  }

  return { customCategories, addCustomCategory };
}
