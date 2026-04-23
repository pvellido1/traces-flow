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
  rootService: string;
}

interface TraceData {
  traceId: string;
  startTime: string;
  duration: number;
  status: "success" | "error";
  services: string[];
}

export const TracesTable: React.FC<TracesTableProps> = ({ path, filters, rootService }) => {
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

  // Query fetches ALL spans for traces that contain the selected path's root service
  // Uses lookup to filter to relevant traces, then fetches complete hierarchy
  const query = `fetch spans${timeframeClause}
| filter isNotNull(trace.id)
| lookup [
    fetch spans${timeframeClause}
    | filter dt.service.name == "${rootService}"
    | summarize count(), by: {trace.id}
    | limit ${maxTraces}
  ], sourceField: trace.id, lookupField: trace.id, prefix: "match_"
| filter isNotNull(match_trace.id)
| fields trace.id, span.id, span.parent_id, dt.service.name, start_time, request.is_failed, duration
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
    startTime: string;
    isFailed: boolean;
    duration: number;
  }

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
    rootSpans.sort((a, b) => a.startTime.localeCompare(b.startTime));

    // BFS traversal
    const serviceOrder: string[] = [];
    const visited = new Set<string>();
    const queue: SpanInfo[] = [...rootSpans];

    while (queue.length > 0) {
      const span = queue.shift()!;
      if (visited.has(span.spanId)) continue;
      visited.add(span.spanId);

      // Only add if service name exists and not already in order
      if (span.serviceName && !serviceOrder.includes(span.serviceName)) {
        serviceOrder.push(span.serviceName);
      }

      const children = childrenMap.get(span.spanId) || [];
      children.sort((a, b) => a.startTime.localeCompare(b.startTime));
      queue.push(...children);
    }

    return serviceOrder;
  };

  // Helper function to check if trace path STARTS WITH selected path (prefix matching)
  // This allows clicking on intermediate nodes to show all traces going through that path
  const matchesPath = (traceServices: string[]): boolean => {
    // Trace must have at least as many services as the selected path
    if (traceServices.length < path.length) return false;
    // Check if the trace starts with the selected path
    for (let i = 0; i < path.length; i++) {
      if (traceServices[i] !== path[i]) return false;
    }
    return true;
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
    const span: SpanInfo = {
      spanId: String(record["span.id"] || ""),
      parentId: record["span.parent_id"] ? String(record["span.parent_id"]) : null,
      serviceName: rawServiceName ? String(rawServiceName) : null,
      startTime: String(record["start_time"] || ""),
      isFailed: record["request.is_failed"] === true,
      duration: (record["duration"] as number) || 0,
    };
    
    if (!traceSpansMap.has(traceId)) {
      traceSpansMap.set(traceId, []);
    }
    traceSpansMap.get(traceId)!.push(span);
  });

  // Build traces with hierarchy-based service order
  const allTraces: TraceData[] = [];
  traceSpansMap.forEach((spans, traceId) => {
    const serviceOrder = buildServiceOrderFromHierarchy(spans);
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
    });
  });

  // Filter to traces containing rootService and matching the selected path
  const traces = allTraces
    .filter((trace) => trace.services.includes(rootService))
    .filter((trace) => matchesPath(trace.services))
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
