const FOXIE_GATEWAY_URL = process.env.FOXIE_GATEWAY_URL;
const RETRY_DELAYS_MS = [1000, 5000, 30000];

interface FoxieCompletionPayload {
  feedbackRequestId: string | null;
  respondentContactId: string | null;
  timestamp: string;
  completionDegree: "full" | "partial";
}

export async function sendFoxieCompletionSignal(payload: FoxieCompletionPayload): Promise<void> {
  if (!FOXIE_GATEWAY_URL) return; // Gateway not configured — skip silently

  const body = JSON.stringify({
    feedback_request_id: payload.feedbackRequestId,
    completion_degree: payload.completionDegree,
    timestamp: payload.timestamp,
    respondent_contact_id: payload.respondentContactId,
  });

  const url = `${FOXIE_GATEWAY_URL}/signals/feedback-completed`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) return;
    console.error(`[foxie] completion signal HTTP ${res.status} on attempt 1`);
  } catch (err) {
    console.error(`[foxie] completion signal network error on attempt 1:`, err);
  }

  // First attempt failed — schedule retries in background (non-blocking)
  scheduleRetries(url, body);
}

function scheduleRetries(url: string, body: string): void {
  // Fire-and-forget — retries run detached from the pipeline handler
  (async () => {
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (res.ok) return;
        console.error(`[foxie] completion signal HTTP ${res.status} on attempt ${i + 2}`);
      } catch (err) {
        console.error(`[foxie] completion signal network error on attempt ${i + 2}:`, err);
      }
    }
    console.error(`[foxie] completion signal failed after all retries`);
  })();
}
