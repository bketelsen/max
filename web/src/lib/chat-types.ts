export type RouteInfo = {
  model: string;
  tier?: string | null;
  routerMode: "auto" | "manual";
  overrideName?: string;
};

export type UIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  route?: RouteInfo;
  proactive?: boolean;
};

export function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
