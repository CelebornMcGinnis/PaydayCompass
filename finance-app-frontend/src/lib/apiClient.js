import { getIdToken } from "./cognito";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(status, body) {
    // body.error is this app's own Lambda error shape (see
    // finance_common.http_response); body.message is what API Gateway
    // itself uses for a rejection that never reaches a Lambda at all
    // (an expired/invalid auth token, throttling) - falling back to
    // that instead of raw JSON keeps those readable too, now that the
    // API Gateway CORS gap no longer hides them as a generic network error.
    super(typeof body === "object" ? body.error || body.message || JSON.stringify(body) : String(body));
    this.status = status;
    this.body = body;
  }
}

/**
 * Every request goes through here: attaches the current user's Cognito ID
 * token (required by every route - see the CognitoUserPoolsAuthorizer in
 * lib/constructs/api.ts), and normalizes errors into ApiError so callers
 * can branch on .status instead of parsing response bodies themselves.
 */
async function request(method, path, body) {
  const token = await getIdToken();
  if (!token) {
    throw new ApiError(401, "Not signed in");
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // A raw network-level failure (no connectivity, DNS, server
    // unreachable) throws a browser TypeError here, not an HTTP
    // response - its message is an unhelpful, browser-specific string
    // ("Load failed" on Safari, "Failed to fetch" on Chrome), not
    // something to show directly. This never means the request
    // definitely didn't happen server-side (a response could still be
    // in flight when connectivity drops) - just that this device never
    // got to see the result.
    throw new ApiError(0, "Couldn't reach the server - check your connection and try again. If you're not sure whether this went through, refresh and check before retrying.");
  }

  // 204 No Content and CSV export responses have no JSON body to parse
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

async function publicRequest(method, path, body) {
  // For endpoints that don't require sign-in (currently just /contact,
  // since it must be reachable from the pre-login Landing page) - same
  // network-error handling as request(), just no auth token attached.
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server - check your connection and try again. If you're not sure whether this went through, refresh and check before retrying.");
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  del: (path) => request("DELETE", path),
};

// ---- Typed helpers for the endpoints wired so far --------------------------
// Adding a new screen? Add its calls here rather than calling `api.*`
// directly from components - keeps every screen's actual endpoint usage
// in one place, matching the CDK API route reference in the docs.

export const accountsApi = {
  list: () => api.get("/accounts"),
  create: (body) => api.post("/accounts", body),
  update: (accountId, body) => api.put(`/accounts/${accountId}`, body),
  remove: (accountId) => api.del(`/accounts/${accountId}`),
  reorder: (accountIds) => api.put("/accounts/reorder", { accountIds }),
};

export const divisionsApi = {
  list: (accountId) => api.get(`/accounts/${accountId}/divisions`),
  create: (accountId, body) => api.post(`/accounts/${accountId}/divisions`, body),
  update: (accountId, divisionId, body) => api.put(`/accounts/${accountId}/divisions/${divisionId}`, body),
  remove: (accountId, divisionId) => api.del(`/accounts/${accountId}/divisions/${divisionId}`),
};

export const transactionsApi = {
  list: (accountId) => api.get(`/accounts/${accountId}/transactions`),
  addExpense: (accountId, body) => api.post(`/accounts/${accountId}/transactions`, body),
  addIncome: (accountId, body) => api.post(`/accounts/${accountId}/income`, body),
  update: (accountId, txnId, body) => api.put(`/accounts/${accountId}/transactions/${txnId}`, body),
  remove: (accountId, txnId) => api.del(`/accounts/${accountId}/transactions/${txnId}`),
  transfer: (body) => api.post("/transactions/transfer", body),
  editPurchase: (accountId, purchaseId, body) => api.put(`/accounts/${accountId}/transactions/purchase/${purchaseId}`, body),
  removePurchase: (accountId, purchaseId) => api.del(`/accounts/${accountId}/transactions/purchase/${purchaseId}`),
};

export const projectionsApi = {
  get: () => api.get("/projections"),
};

export const budgetsApi = {
  list: () => api.get("/budgets"),
  upsert: (body) => api.post("/budgets", body),
  remove: (sk) => api.del(`/budgets/${encodeURIComponent(sk)}`),
  projectedVsActual: (numPeriods) => api.get(`/budgets/projected-vs-actual?numPeriods=${numPeriods}`),
};

export const paydayApi = {
  upcoming: (date) => api.get(date ? `/payday/upcoming?date=${date}` : "/payday/upcoming"),
  submit: (body) => api.post("/payday/submit", body),
  history: () => api.get("/payday/history"),
  reverse: (paydayDate) => api.post("/payday/reverse", { paydayDate }),
};

export const externalBankAccountsApi = {
  list: () => api.get("/external-bank-accounts"),
  create: (body) => api.post("/external-bank-accounts", body),
  update: (id, body) => api.put(`/external-bank-accounts/${id}`, body),
  remove: (id) => api.del(`/external-bank-accounts/${id}`),
};

export const recurringApi = {
  list: (accountId) => api.get(`/accounts/${accountId}/recurring`),
  create: (accountId, body) => api.post(`/accounts/${accountId}/recurring`, body),
  update: (accountId, recurringId, body) => api.put(`/accounts/${accountId}/recurring/${recurringId}`, body),
  remove: (accountId, recurringId) => api.del(`/accounts/${accountId}/recurring/${recurringId}`),
  setOccurrence: (accountId, recurringId, body) =>
    api.put(`/accounts/${accountId}/recurring/${recurringId}/occurrence`, body),
};

export const preferencesApi = {
  get: () => api.get("/preferences"),
  update: (body) => api.put("/preferences", body),
};

export const plannedExpensesApi = {
  list: () => api.get("/planned-expenses"),
  create: (body) => api.post("/planned-expenses", body),
  update: (id, body) => api.put(`/planned-expenses/${id}`, body),
  remove: (id) => api.del(`/planned-expenses/${id}`),
  markComplete: (id) => api.post(`/planned-expenses/${id}/complete`),
};

export const sharingApi = {
  list: () => api.get("/sharing"),
  create: (body) => api.post("/sharing", body),
  respond: (ownerUserId, status) => api.put(`/sharing/${ownerUserId}`, { status }),
  revoke: (invitedUserId) => api.del(`/sharing/${invitedUserId}`),
  updatePermissions: (invitedUserId, accountId, body) => api.put(`/sharing/${invitedUserId}/accounts/${accountId}`, body),
};

export const scenariosApi = {
  list: () => api.get("/scenarios"),
  save: (body) => api.post("/scenarios", body),
  remove: (id) => api.del(`/scenarios/${id}`),
  calculateThrowaway: (body) => api.post("/scenarios/calculate", body),
  calculateSaved: (id) => api.get(`/scenarios/${id}/calculate`),
  compare: (body) => api.post("/scenarios/compare", body),
  trend: (body) => api.post("/scenarios/trend", body),
};

export const peerAgreementsApi = {
  list: () => api.get("/peer-agreements"),
  propose: (body) => api.post("/peer-agreements", body),
  respond: (senderUserId, status) => api.put(`/peer-agreements/${senderUserId}`, { status }),
  revoke: (otherUserId) => api.del(`/peer-agreements/revoke/${otherUserId}`),
};

export const peerNotificationsApi = {
  list: () => api.get("/peer-notifications"),
  create: (body) => api.post("/peer-notifications", body),
  remove: (id) => api.del(`/peer-notifications/${id}`),
};

export const accountDeletionApi = {
  deleteMe: () => api.post("/account/delete-me"),
};

export const contactApi = {
  send: (body) => publicRequest("POST", "/contact", body),
};
