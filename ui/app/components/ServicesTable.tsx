import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import {
  DataTable,
  DataTableColumnDef,
} from "@dynatrace/strato-components-preview/tables";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { FilterValues } from "./ServiceFilters";

interface ServicesTableProps {
  filters: FilterValues;
  onViewTracesFlow: (service: ServiceData) => void;
}

export interface ServiceData {
  serviceName: string;
  serviceId: string;
  requestCount: number;
  errorRate: number;
  avgDuration: number;
  technology: string | null;
  k8sNamespace: string | null;
}

export const ServicesTable: React.FC<ServicesTableProps> = ({
  filters,
  onViewTracesFlow,
}) => {
  // Build timeframe for DQL - use expression format when available
  const getTimeframeParam = () => {
    if (!filters.timeframe) return "";
    if (filters.timeframe.from.type === "expression") {
      return `, from: ${filters.timeframe.from.value}, to: ${filters.timeframe.to.value}`;
    }
    return `, from: timestamp("${filters.timeframe.from.absoluteDate}"), to: timestamp("${filters.timeframe.to.absoluteDate}")`;
  };
  
  const timeframeClause = getTimeframeParam();

  // Build filter conditions
  const conditions: string[] = [];

  if (filters.k8sCluster) {
    conditions.push(`k8s.cluster.name == "${filters.k8sCluster}"`);
  }
  if (filters.k8sNamespace) {
    conditions.push(`k8s.namespace.name == "${filters.k8sNamespace}"`);
  }
  if (filters.k8sWorkload) {
    conditions.push(`k8s.workload.name == "${filters.k8sWorkload}"`);
  }
  if (filters.technology) {
    conditions.push(`telemetry.sdk.language == "${filters.technology}"`);
  }
  if (filters.cloudProvider) {
    conditions.push(`cloud.provider == "${filters.cloudProvider}"`);
  }
  if (filters.serviceName) {
    conditions.push(`contains(dt.service.name, "${filters.serviceName}")`);
  }

  const filterClause =
    conditions.length > 0 ? `| filter ${conditions.join(" AND ")}` : "";

  // Build tag filter using lookup from entities (tags are on entities, not spans)
  // Use iAny() for iterative array matching
  const tagLookupClause = filters.serviceTags.length > 0
    ? `| lookup [
    fetch dt.entity.service 
    | filter iAny(${filters.serviceTags.map(tag => `tags[] == "${tag}"`).join(" OR ")})
    | fields id
  ], sourceField: dt.smartscape.service, lookupField: id, prefix: "tagged_"
| filter isNotNull(tagged_id)`
    : "";

  const query = `fetch spans${timeframeClause}
| filter request.is_root_span == true
| filter isNotNull(dt.service.name)
${filterClause}
${tagLookupClause}
| summarize 
    requestCount = count(),
    errorCount = countIf(request.is_failed == true),
    avgDuration = avg(duration),
    technology = takeAny(telemetry.sdk.language),
    k8sNamespace = takeAny(k8s.namespace.name),
    by: {dt.service.name, dt.smartscape.service}
| fieldsAdd errorRate = (errorCount * 100.0) / requestCount
| sort requestCount desc
| limit ${filters.maxRecords || 100}`;

  const { data, isLoading, error } = useDql({ query });

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
        <Text>Error loading services: {error.message}</Text>
      </Flex>
    );
  }

  const services: ServiceData[] =
    data?.records?.map((record) => ({
      serviceName: record["dt.service.name"] as string,
      serviceId: record["dt.smartscape.service"] as string,
      requestCount: record["requestCount"] as number,
      errorRate: record["errorRate"] as number,
      avgDuration: record["avgDuration"] as number,
      technology: record["technology"] as string | null,
      k8sNamespace: record["k8sNamespace"] as string | null,
    })) || [];

  const columns: DataTableColumnDef<ServiceData>[] = [
    {
      id: "serviceName",
      header: "Service Name",
      accessor: "serviceName",
    },
    {
      id: "technology",
      header: "Technology",
      accessor: "technology",
      cell: ({ value }) => value || "-",
    },
    {
      id: "k8sNamespace",
      header: "K8s Namespace",
      accessor: "k8sNamespace",
      cell: ({ value }) => value || "-",
    },
    {
      id: "requestCount",
      header: "Requests",
      accessor: "requestCount",
      cell: ({ value }) => value?.toLocaleString() || "0",
    },
    {
      id: "errorRate",
      header: "Error Rate",
      accessor: "errorRate",
      cell: ({ value }) => (value ? `${value.toFixed(2)}%` : "0%"),
    },
    {
      id: "avgDuration",
      header: "Avg Duration",
      accessor: "avgDuration",
      cell: ({ value }) => {
        if (!value) return "-";
        const ms = value / 1_000_000; // nanoseconds to ms
        return ms < 1000 ? `${ms.toFixed(2)} ms` : `${(ms / 1000).toFixed(2)} s`;
      },
    },
    {
      id: "actions",
      header: "Actions",
      accessor: (row) => row,
      cell: ({ rowData }) => (
        <Button
          variant="accent"
          color="primary"
          onClick={() => onViewTracesFlow(rowData)}
        >
          View Traces Flow
        </Button>
      ),
    },
  ];

  return (
    <Flex flexDirection="column" gap={16}>
      <Heading level={3}>
        Services ({services.length})
      </Heading>
      {services.length === 0 ? (
        <Text>No services found matching the filters.</Text>
      ) : (
        <DataTable
          data={services}
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
