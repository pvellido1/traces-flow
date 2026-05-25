import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import {
  DataTable,
  DataTableColumnDef,
} from "@dynatrace/strato-components-preview/tables";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Chip } from "@dynatrace/strato-components-preview/content";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { FilterValues } from "./ServiceFilters";
import { ExternalLinkIcon } from "@dynatrace/strato-icons";

interface TracesTableProps {
  path: string[];
  filters: FilterValues;
  rootServiceId: string;
  rootServiceName: string;
}

interface TraceData {
  traceId: string;
  startTime: string;
  duration: number;
  status: "success" | "error";
  services: string[];
}

export const TracesTable: React.FC<TracesTableProps> = ({ path, filters, rootServiceId, rootServiceName }) => {
  // Build timeframe for DQL - use expression format when available
  const getTimeframeParam = () => {
    if (!filters.timeframe) return "";
    if (filters.timeframe.from.type === "expression") {
      return `, from: ${filters.timeframe.from.value}, to: ${filters.timeframe.to.value}`;
    }
    return `, from: timestamp("${filters.timeframe.from.absoluteDate}"), to: timestamp("${filters.timeframe.to.absoluteDate}")`;
  };
  
  const timeframeClause = getTimeframeParam();

  // Calculate limits - DQL has a max of ~1 million records
  const maxTraces = filters.maxRecords || 500;
  const maxSpans = Math.min(maxTraces * 100, 1000000); // Cap at 1M spans

  // Detect if path is from endpoint view (endpoint keys contain "@")
  const isEndpointPath = path.length > 0 && path[0].includes("@");

  // Query fetches ALL spans for traces that contain the selected path's root service
  // Uses lookup to filter to relevant traces, then fetches complete hierarchy
  // Filter by service entity ID (dt.smartscape.service) which is more reliable than name
  const query = `fetch spans${timeframeClause}
| filter isNotNull(trace.id)
| lookup [
    fetch spans${timeframeClause}
    | filter dt.smartscape.service == "${rootServiceId}"
    | summarize count(), by: {trace.id}
    | limit ${maxTraces}
  ], sourceField: trace.id, lookupField: trace.id, prefix: "match_"
| filter isNotNull(match_trace.id)
| fields trace.id, span.id, span.parent_id, dt.service.name, endpoint.name, span.name, start_time, request.is_failed, duration
| sort trace.id, start_time asc
| limit ${maxSpans}`;

  const { data, isLoading, error } = useDql({ 
    query,
    maxResultRecords: maxSpans 
  });

  const openTraceInDistributedTracing = (traceId: string) => {
    // Use intent to open the trace in Distributed Tracing app
    sendIntent({
      "trace.id": traceId,
    });
  };

  // Build service order from parent-child hierarchy (same logic as TracesFlowDiagram)
  interface SpanInfo {
    spanId: string;
    parentId: string | null;
    serviceName: string | null;  // null for spans without service
    endpointName: string | null; // endpoint.name or span.name as fallback
    startTime: string;
    isFailed: boolean;
    duration: number;
  }

  // Build service order from parent-child hierarchy using DFS (matches TracesFlowDiagram)
  const buildServiceOrderFromHierarchy = (spans: SpanInfo[]): string[] => {
    const spanMap = new Map<string, SpanInfo>();
    const childrenMap = new Map<string | null, SpanInfo[]>();
    
    spans.forEach(span => {
      spanMap.set(span.spanId, span);
      if (!childrenMap.has(span.parentId)) {
        childrenMap.set(span.parentId, []);
      }
      childrenMap.get(span.parentId)!.push(span);
    });

    // Find root spans
    const rootSpans = spans.filter(span => 
      span.parentId === null || !spanMap.has(span.parentId)
    );
    // Sort by spanId for deterministic ordering (not by time)
    rootSpans.sort((a, b) => a.spanId.localeCompare(b.spanId));

    // DFS traversal - children immediately after parent
    const serviceOrder: string[] = [];
    const visited = new Set<string>();

    const processSpan = (span: SpanInfo) => {
      if (visited.has(span.spanId)) return;
      visited.add(span.spanId);

      // Only add if service name exists and not already in order
      if (span.serviceName && !serviceOrder.includes(span.serviceName)) {
        serviceOrder.push(span.serviceName);
      }

      // Process children immediately (DFS)
      const children = childrenMap.get(span.spanId) || [];
      children.sort((a, b) => a.spanId.localeCompare(b.spanId));
      children.forEach(child => processSpan(child));
    };

    rootSpans.forEach(root => processSpan(root));
    return serviceOrder;
  };

  // Build endpoint order from parent-child hierarchy using DFS (matches TracesFlowDiagram)
  const buildEndpointOrderFromHierarchy = (spans: SpanInfo[]): string[] => {
    const spanMap = new Map<string, SpanInfo>();
    const childrenMap = new Map<string | null, SpanInfo[]>();
    
    spans.forEach(span => {
      spanMap.set(span.spanId, span);
      if (!childrenMap.has(span.parentId)) {
        childrenMap.set(span.parentId, []);
      }
      childrenMap.get(span.parentId)!.push(span);
    });

    // Find root spans
    const rootSpans = spans.filter(span => 
      span.parentId === null || !spanMap.has(span.parentId)
    );
    // Sort by spanId for deterministic ordering (not by time)
    rootSpans.sort((a, b) => a.spanId.localeCompare(b.spanId));

    // DFS traversal - children immediately after parent
    const endpointOrder: string[] = [];
    const visited = new Set<string>();
    const seenKeys = new Set<string>();

    const processSpan = (span: SpanInfo) => {
      if (visited.has(span.spanId)) return;
      visited.add(span.spanId);

      // Build endpoint key: endpoint@service (same as TracesFlowDiagram)
      if (span.endpointName && span.serviceName) {
        const key = `${span.endpointName}@${span.serviceName}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          endpointOrder.push(key);
        }
      } else if (span.serviceName) {
        // Fallback for spans without endpoint
        const key = `(no endpoint)@${span.serviceName}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          endpointOrder.push(key);
        }
      }

      // Process children immediately (DFS)
      const children = childrenMap.get(span.spanId) || [];
      children.sort((a, b) => a.spanId.localeCompare(b.spanId));
      children.forEach(child => processSpan(child));
    };

    rootSpans.forEach(root => processSpan(root));
    return endpointOrder;
  };

  // Helper function to check if trace contains the selected path as a subsequence
  // This allows traces that have additional services/endpoints between the ones in the path
  const matchesPath = (traceOrder: string[]): boolean => {
    if (path.length === 0) return false;
    if (traceOrder.length < path.length) return false;
    
    // Check if all path elements appear in traceOrder in the same order
    // (not necessarily consecutively - allows intermediate services)
    let pathIdx = 0;
    for (let i = 0; i < traceOrder.length && pathIdx < path.length; i++) {
      if (traceOrder[i] === path[pathIdx]) {
        pathIdx++;
      }
    }
    return pathIdx === path.length;
  };

  if (isLoading) {
    return (
      <Flex justifyContent="center" padding={32}>
        <ProgressCircle />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex padding={16}>
        <Text>Error loading traces: {error.message}</Text>
      </Flex>
    );
  }

  // Group spans by trace and build hierarchy-based service order
  const traceSpansMap = new Map<string, SpanInfo[]>();
  
  data?.records?.forEach((record) => {
    const traceId = String(record["trace.id"]);
    const rawServiceName = record["dt.service.name"];
    const rawEndpointName = record["endpoint.name"];
    const rawSpanName = record["span.name"];
    // Use endpoint.name if available, otherwise fall back to span.name
    const effectiveEndpoint = rawEndpointName ? String(rawEndpointName) : (rawSpanName ? String(rawSpanName) : null);
    const span: SpanInfo = {
      spanId: String(record["span.id"] || ""),
      parentId: record["span.parent_id"] ? String(record["span.parent_id"]) : null,
      serviceName: rawServiceName ? String(rawServiceName) : null,
      endpointName: effectiveEndpoint,
      startTime: String(record["start_time"] || ""),
      isFailed: record["request.is_failed"] === true,
      duration: (record["duration"] as number) || 0,
    };
    
    if (!traceSpansMap.has(traceId)) {
      traceSpansMap.set(traceId, []);
    }
    traceSpansMap.get(traceId)!.push(span);
  });

  // Build traces with hierarchy-based order (service or endpoint depending on path type)
  interface ExtendedTraceData extends TraceData {
    endpointOrder: string[];
  }
  const allTraces: ExtendedTraceData[] = [];
  traceSpansMap.forEach((spans, traceId) => {
    const serviceOrder = buildServiceOrderFromHierarchy(spans);
    const endpointOrder = buildEndpointOrderFromHierarchy(spans);
    const hasFailed = spans.some(s => s.isFailed);
    const earliestStart = spans.reduce((min, s) => 
      s.startTime < min ? s.startTime : min, spans[0]?.startTime || "");
    // Find root span duration (span with no parent in set)
    const rootSpan = spans.find(s => s.parentId === null || !spans.some(p => p.spanId === s.parentId));
    
    allTraces.push({
      traceId,
      startTime: earliestStart,
      duration: rootSpan?.duration || 0,
      status: hasFailed ? "error" : "success",
      services: serviceOrder,
      endpointOrder: endpointOrder,
    });
  });

  // Filter to traces matching the selected path
  // The query already filters to traces containing the selected service via lookup
  // Use endpoint order for matching if path is from endpoint view
  const traces = allTraces
    .filter((trace) => matchesPath(isEndpointPath ? trace.endpointOrder : trace.services))
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, filters.maxRecords || 500);

  const columns: DataTableColumnDef<TraceData>[] = [
    {
      id: "traceId",
      header: "Trace ID",
      accessor: "traceId",
      cell: ({ value }) => (
        <Text style={{ fontFamily: "monospace", fontSize: 12 }}>
          {value ? value.substring(0, 16) + "..." : "-"}
        </Text>
      ),
    },
    {
      id: "startTime",
      header: "Timestamp",
      accessor: "startTime",
      cell: ({ value }) => {
        if (!value) return "-";
        const date = new Date(value);
        return date.toLocaleString();
      },
    },
    {
      id: "duration",
      header: "Duration",
      accessor: "duration",
      cell: ({ value }) => {
        if (!value) return "-";
        const ms = value / 1_000_000; // nanoseconds to ms
        if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
        if (ms < 1000) return `${ms.toFixed(2)} ms`;
        return `${(ms / 1000).toFixed(2)} s`;
      },
    },
    {
      id: "status",
      header: "Status",
      accessor: "status",
      cell: ({ value }) => (
        <Chip color={value === "success" ? "success" : "critical"}>
          {value === "success" ? "Success" : "Error"}
        </Chip>
      ),
    },
    {
      id: "services",
      header: "Services",
      accessor: "services",
      cell: ({ value }) => (
        <Text style={{ fontSize: 12 }}>
          {value?.length || 0} services
        </Text>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      accessor: (row) => row,
      cell: ({ rowData }) => (
        <Button
          variant="emphasized"
          color="neutral"
          onClick={() => openTraceInDistributedTracing(rowData.traceId)}
        >
          <Button.Prefix>
            <ExternalLinkIcon />
          </Button.Prefix>
          View Trace
        </Button>
      ),
    },
  ];

  return (
    <Flex flexDirection="column" gap={16}>
      <Flex justifyContent="space-between" alignItems="center">
        <Heading level={3}>
          Traces for selected path ({traces.length})
        </Heading>
        <Text style={{ fontSize: 12 }}>
          Path: {path.join(" → ")}
        </Text>
      </Flex>
      
      {traces.length === 0 ? (
        <Text>No traces found for the selected path.</Text>
      ) : (
        <DataTable
          data={traces}
          columns={columns}
          sortable
          fullWidth
          variant="default"
        >
          <DataTable.Pagination defaultPageSize={10} />
        </DataTable>
      )}
    </Flex>
  );
};
