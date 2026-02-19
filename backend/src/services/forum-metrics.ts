const FORUM_ACTIONS = ["reaction_toggle", "comment_create", "report_create"] as const;
const STATUS_CLASSES = ["2xx", "4xx", "5xx", "other"] as const;

type ForumAction = (typeof FORUM_ACTIONS)[number];
type StatusClass = (typeof STATUS_CLASSES)[number];

type ForumActionTotals = Record<ForumAction, number>;
type EndpointStatusTotals = Record<StatusClass, number>;

type EndpointMetrics = {
  method: string;
  route: string;
  requestTotal: number;
  statusTotals: EndpointStatusTotals;
  latencyMsSum: number;
  latencyMsMax: number;
};

type ForumMetricsSnapshot = {
  actions: ForumActionTotals;
  endpoints: EndpointMetrics[];
};

const initActionTotals = (): ForumActionTotals => ({
  reaction_toggle: 0,
  comment_create: 0,
  report_create: 0,
});

const initEndpointStatusTotals = (): EndpointStatusTotals => ({
  "2xx": 0,
  "4xx": 0,
  "5xx": 0,
  other: 0,
});

const actionTotals: ForumActionTotals = initActionTotals();
const endpointMetrics = new Map<string, EndpointMetrics>();

const getStatusClass = (statusCode: number): StatusClass => {
  if (statusCode >= 200 && statusCode < 300) {
    return "2xx";
  }

  if (statusCode >= 400 && statusCode < 500) {
    return "4xx";
  }

  if (statusCode >= 500 && statusCode < 600) {
    return "5xx";
  }

  return "other";
};

const sanitizeLabelValue = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const getOrCreateEndpointMetrics = (method: string, route: string): EndpointMetrics => {
  const key = `${method} ${route}`;
  const existing = endpointMetrics.get(key);
  if (existing) {
    return existing;
  }

  const created: EndpointMetrics = {
    method,
    route,
    requestTotal: 0,
    statusTotals: initEndpointStatusTotals(),
    latencyMsSum: 0,
    latencyMsMax: 0,
  };

  endpointMetrics.set(key, created);
  return created;
};

const cloneActionTotals = (input: ForumActionTotals): ForumActionTotals => ({
  reaction_toggle: input.reaction_toggle,
  comment_create: input.comment_create,
  report_create: input.report_create,
});

const cloneEndpointStatusTotals = (input: EndpointStatusTotals): EndpointStatusTotals => ({
  "2xx": input["2xx"],
  "4xx": input["4xx"],
  "5xx": input["5xx"],
  other: input.other,
});

export const recordForumActionMetric = (action: ForumAction): void => {
  actionTotals[action] += 1;
};

export const recordForumEndpointMetric = (input: {
  method: string;
  route: string;
  statusCode: number;
  latencyMs: number;
}): void => {
  const method = input.method.trim().toUpperCase() || "UNKNOWN";
  const route = input.route.trim() || "unknown";
  const bucket = getOrCreateEndpointMetrics(method, route);

  const statusClass = getStatusClass(input.statusCode);
  const latencyMs = Number.isFinite(input.latencyMs) ? Math.max(0, input.latencyMs) : 0;

  bucket.requestTotal += 1;
  bucket.statusTotals[statusClass] += 1;
  bucket.latencyMsSum += latencyMs;
  bucket.latencyMsMax = Math.max(bucket.latencyMsMax, latencyMs);
};

export const getForumMetricsSnapshot = (): ForumMetricsSnapshot => ({
  actions: cloneActionTotals(actionTotals),
  endpoints: [...endpointMetrics.values()].map((entry) => ({
    method: entry.method,
    route: entry.route,
    requestTotal: entry.requestTotal,
    statusTotals: cloneEndpointStatusTotals(entry.statusTotals),
    latencyMsSum: entry.latencyMsSum,
    latencyMsMax: entry.latencyMsMax,
  })),
});

export const renderForumPrometheusMetrics = (): string => {
  const snapshot = getForumMetricsSnapshot();

  const lines: string[] = [
    "# HELP evergreen_backend_forum_actions_total Total forum action events by type.",
    "# TYPE evergreen_backend_forum_actions_total counter",
  ];

  for (const action of FORUM_ACTIONS) {
    lines.push(`evergreen_backend_forum_actions_total{action=\"${action}\"} ${snapshot.actions[action]}`);
  }

  lines.push("# HELP evergreen_backend_forum_endpoint_requests_total Total forum endpoint requests by status class.");
  lines.push("# TYPE evergreen_backend_forum_endpoint_requests_total counter");

  for (const endpoint of snapshot.endpoints) {
    const method = sanitizeLabelValue(endpoint.method);
    const route = sanitizeLabelValue(endpoint.route);

    for (const statusClass of STATUS_CLASSES) {
      lines.push(
        `evergreen_backend_forum_endpoint_requests_total{method=\"${method}\",route=\"${route}\",status_class=\"${statusClass}\"} ${endpoint.statusTotals[statusClass]}`
      );
    }
  }

  lines.push("# HELP evergreen_backend_forum_endpoint_latency_ms_sum Cumulative forum endpoint latency in milliseconds.");
  lines.push("# TYPE evergreen_backend_forum_endpoint_latency_ms_sum counter");
  lines.push("# HELP evergreen_backend_forum_endpoint_latency_ms_count Number of latency samples for forum endpoints.");
  lines.push("# TYPE evergreen_backend_forum_endpoint_latency_ms_count counter");
  lines.push("# HELP evergreen_backend_forum_endpoint_latency_ms_max Maximum observed forum endpoint latency in milliseconds.");
  lines.push("# TYPE evergreen_backend_forum_endpoint_latency_ms_max gauge");

  for (const endpoint of snapshot.endpoints) {
    const method = sanitizeLabelValue(endpoint.method);
    const route = sanitizeLabelValue(endpoint.route);

    lines.push(
      `evergreen_backend_forum_endpoint_latency_ms_sum{method=\"${method}\",route=\"${route}\"} ${endpoint.latencyMsSum}`
    );
    lines.push(
      `evergreen_backend_forum_endpoint_latency_ms_count{method=\"${method}\",route=\"${route}\"} ${endpoint.requestTotal}`
    );
    lines.push(
      `evergreen_backend_forum_endpoint_latency_ms_max{method=\"${method}\",route=\"${route}\"} ${endpoint.latencyMsMax}`
    );
  }

  return `${lines.join("\n")}\n`;
};
