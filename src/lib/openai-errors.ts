import { AppError } from "./security";

export class AIServiceError extends AppError {
  constructor(
    message: string,
    public retryable: boolean,
    public retryAfterMs = 0,
  ) {
    super(message + " Saved-notes proposals and briefs remain available.", 502);
  }
}

export async function assertOpenAIResponse(response: Response) {
  if (response.ok) return;
  // Provider messages can contain request contents; expose only our fixed messages.
  const body = await response.json().catch(() => null);
  const code = body?.error?.code,
    type = body?.error?.type;
  const billing: Record<string, string> = {
    credit_balance_exhausted:
      "OpenAI API credits are exhausted. Add credits in OpenAI billing, then retry.",
    organization_spend_limit_exceeded:
      "OpenAI's organization spend limit was reached. Review organization limits, then retry.",
    project_spend_limit_exceeded:
      "OpenAI's project spend limit was reached. Review the connected project's limits, then retry.",
    organization_usage_limit_exceeded:
      "OpenAI's approved organization usage limit was reached. Request a higher limit before retrying.",
  };
  if (typeof code === "string" && Object.hasOwn(billing, code))
    throw new AIServiceError(billing[code], false);
  if (code === "insufficient_quota" || type === "insufficient_quota")
    throw new AIServiceError(
      "OpenAI API credits or spend/usage limits prevent generation. Review OpenAI billing and limits before retrying.",
      false,
    );
  if (response.status === 401 || code === "invalid_api_key")
    throw new AIServiceError(
      "OpenAI authentication failed. Review the server's configured API key before retrying.",
      false,
    );
  if (response.status === 403 || code === "model_not_found")
    throw new AIServiceError(
      "OpenAI model or project access is unavailable. Review the configured model and project permissions before retrying.",
      false,
    );
  const delay = response.headers.get("retry-after"),
    seconds = delay === null ? NaN : Number(delay),
    milliseconds = Number.isFinite(seconds)
      ? seconds * 1000
      : delay
        ? Date.parse(delay) - Date.now()
        : 0,
    retryAfterMs = Number.isFinite(milliseconds)
      ? Math.min(86400000, Math.max(0, milliseconds))
      : 0;
  if (response.status === 429)
    throw new AIServiceError(
      "OpenAI temporarily limited requests. Wait before retrying.",
      true,
      retryAfterMs,
    );
  if (response.status >= 500)
    throw new AIServiceError(
      "OpenAI is temporarily unavailable. Retry after waiting.",
      true,
      retryAfterMs,
    );
  throw new AIServiceError(
    "OpenAI rejected the request. Review the integration configuration before retrying.",
    false,
  );
}
