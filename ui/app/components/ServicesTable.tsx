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
  k8sCluster: string | null;
  k8sNamespace: string | null;
  k8sWorkload: string | null;
  tags: string | null;
}

export const ServicesTable: React.FC<ServicesTableProps> = ({
  filters,
  onViewTracesFlow,
}) => {
  // Build entity filter conditions
  const filterConditions: string[] = [];

  if (filters.k8sCluster) {
    filterConditions.push(`| filter k8s_cluster == "${filters.k8sCluster}"`);
  }
  if (filters.k8sNamespace) {
    filterConditions.push(`| filter k8s_namespace == "${filters.k8sNamespace}"`);
  }
  if (filters.k8sWorkload) {
    filterConditions.push(`| filter k8s_workload == "${filters.k8sWorkload}"`);
  }
  if (filters.serviceName) {
    filterConditions.push(`| filter contains(entity.name, "${filters.serviceName}")`);
  }
  if (filters.serviceTags.length > 0) {
    filterConditions.push(`| filter iAny(${filters.serviceTags.map(tag => `tags[] == "${tag}"`).join(" OR ")})`);
  }

  const query = `fetch dt.entity.service
| fields id, entity.name, tags, belongs_to, clustered_by
| expand belongs_to[dt.entity.cloud_application]
| expand belongs_to[dt.entity.cloud_application_namespace]
| expand clustered_by[dt.entity.kubernetes_cluster]
| fieldsAdd k8s_workload = entityName(\`belongs_to[dt.entity.cloud_application]\`, type:"dt.entity.cloud_application")
| fieldsAdd k8s_namespace = entityName(\`belongs_to[dt.entity.cloud_application_namespace]\`, type:"dt.entity.cloud_application_namespace")
| fieldsAdd k8s_cluster = entityName(\`clustered_by[dt.entity.kubernetes_cluster]\`, type:"dt.entity.kubernetes_cluster")
${filterConditions.join("\n")}
| dedup id
| fields id, entity.name, tags, k8s_cluster, k8s_namespace, k8s_workload
| sort entity.name asc
| limit ${filters.maxRecords || 1000}`;

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
      serviceName: String(record["entity.name"] || ""),
      serviceId: String(record["id"] || ""),
      k8sCluster: record["k8s_cluster"] ? String(record["k8s_cluster"]) : null,
      k8sNamespace: record["k8s_namespace"] ? String(record["k8s_namespace"]) : null,
      k8sWorkload: record["k8s_workload"] ? String(record["k8s_workload"]) : null,
      tags: Array.isArray(record["tags"]) ? (record["tags"] as string[]).join(", ") : record["tags"] ? String(record["tags"]) : null,
    })) || [];

  const columns: DataTableColumnDef<ServiceData>[] = [
    {
      id: "serviceName",
      header: "Service Name",
      accessor: "serviceName",
    },
    {
      id: "k8sCluster",
      header: "K8s Cluster",
      accessor: "k8sCluster",
      cell: ({ value }) => value || "-",
    },
    {
      id: "k8sNamespace",
      header: "K8s Namespace",
      accessor: "k8sNamespace",
      cell: ({ value }) => value || "-",
    },
    {
      id: "k8sWorkload",
      header: "K8s Workload",
      accessor: "k8sWorkload",
      cell: ({ value }) => value || "-",
    },
    {
      id: "tags",
      header: "Tags",
      accessor: "tags",
      cell: ({ value }) => value || "-",
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
