import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { TextInput } from "@dynatrace/strato-components-preview/forms";
import { Select, SelectOption, SelectContent, SelectFilter } from "@dynatrace/strato-components-preview/forms";
import { TimeframeSelector } from "@dynatrace/strato-components-preview/filters";
import { NumberInput } from "@dynatrace/strato-components-preview/forms";
import { Label } from "@dynatrace/strato-components-preview/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { useDql } from "@dynatrace-sdk/react-hooks";

interface TimeValue {
  absoluteDate: string;
  value: string;
  type: "expression" | "iso8601";
}

interface Timeframe {
  from: TimeValue;
  to: TimeValue;
}

export interface FilterValues {
  k8sCluster: string | null;
  k8sNamespace: string | null;
  k8sWorkload: string | null;
  serviceTags: string[];
  serviceName: string;
  timeframe: Timeframe | null;
  maxRecords: number;
}

interface ServiceFiltersProps {
  filters: FilterValues;
  onFilterChange: (filters: FilterValues) => void;
}

export const ServiceFilters: React.FC<ServiceFiltersProps> = ({
  filters,
  onFilterChange,
}) => {
  // Build timeframe for DQL
  const getTimeframeParam = () => {
    if (!filters.timeframe) {
      // Default to last 2 hours if no timeframe
      return ", from: now() - 2h";
    }
    // Use the value expression if available (like "now()-2h")
    const fromValue = filters.timeframe.from.value || filters.timeframe.from.absoluteDate;
    const toValue = filters.timeframe.to.value || filters.timeframe.to.absoluteDate;
    
    // If values look like expressions (contain "now"), use them directly
    if (fromValue.includes("now")) {
      return `, from: ${fromValue}, to: ${toValue}`;
    }
    // Otherwise treat as ISO dates - but for simplicity use a relative time
    return ", from: now() - 24h";
  };
  
  const timeframeClause = getTimeframeParam();
  const limitClause = `| limit ${filters.maxRecords || 1000}`;

  // Query for service names from dt.entity.service
  const { data: servicesData, error: servicesError, isLoading: servicesLoading } = useDql({
    query: `fetch dt.entity.service
| fields entity.name
| sort entity.name asc
${limitClause}`,
  });

  // Query for K8s clusters using entityName with type parameter
  const { data: clustersData, error: clustersError } = useDql({
    query: `fetch dt.entity.service
| expand clustered_by[dt.entity.kubernetes_cluster]
| fieldsAdd k8s_cluster = entityName(\`clustered_by[dt.entity.kubernetes_cluster]\`, type:"dt.entity.kubernetes_cluster")
| filter isNotNull(k8s_cluster)
| summarize count(), by: {k8s_cluster}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for K8s namespaces using entityName with type parameter
  const namespaceClusterFilter = filters.k8sCluster
    ? `| expand clustered_by[dt.entity.kubernetes_cluster]
| fieldsAdd k8s_cluster = entityName(\`clustered_by[dt.entity.kubernetes_cluster]\`, type:"dt.entity.kubernetes_cluster")
| filter k8s_cluster == "${filters.k8sCluster}"`
    : "";
  const { data: namespacesData } = useDql({
    query: `fetch dt.entity.service
| expand belongs_to[dt.entity.cloud_application_namespace]
${namespaceClusterFilter}
| fieldsAdd k8s_namespace = entityName(\`belongs_to[dt.entity.cloud_application_namespace]\`, type:"dt.entity.cloud_application_namespace")
| filter isNotNull(k8s_namespace)
| summarize count(), by: {k8s_namespace}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for K8s workloads using entityName with type parameter
  const workloadClusterFilter = filters.k8sCluster
    ? `| expand clustered_by[dt.entity.kubernetes_cluster]
| fieldsAdd k8s_cluster = entityName(\`clustered_by[dt.entity.kubernetes_cluster]\`, type:"dt.entity.kubernetes_cluster")
| filter k8s_cluster == "${filters.k8sCluster}"`
    : "";
  const workloadNamespaceFilter = filters.k8sNamespace
    ? `| expand belongs_to[dt.entity.cloud_application_namespace]
| fieldsAdd k8s_namespace = entityName(\`belongs_to[dt.entity.cloud_application_namespace]\`, type:"dt.entity.cloud_application_namespace")
| filter k8s_namespace == "${filters.k8sNamespace}"`
    : "";
  const { data: workloadsData } = useDql({
    query: `fetch dt.entity.service
| expand belongs_to[dt.entity.cloud_application]
${workloadClusterFilter}
${workloadNamespaceFilter}
| fieldsAdd k8s_workload = entityName(\`belongs_to[dt.entity.cloud_application]\`, type:"dt.entity.cloud_application")
| filter isNotNull(k8s_workload)
| summarize count(), by: {k8s_workload}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for service tags
  const tagsClusterFilter = filters.k8sCluster
    ? `| expand clustered_by[dt.entity.kubernetes_cluster]
| fieldsAdd k8s_cluster = entityName(\`clustered_by[dt.entity.kubernetes_cluster]\`, type:"dt.entity.kubernetes_cluster")
| filter k8s_cluster == "${filters.k8sCluster}"`
    : "";
  const { data: tagsData, isLoading: tagsLoading } = useDql({
    query: `fetch dt.entity.service
| filter isNotNull(tags) AND arraySize(tags) > 0
${tagsClusterFilter}
| expand tag = tags
| summarize count(), by: {tag}
| sort \`count()\` desc
| limit 100`,
  });



  // Helper to extract values from DQL records - handles field names with or without quotes
  const extractValues = (records: Record<string, unknown>[] | undefined, fieldName: string): string[] => {
    if (!records || records.length === 0) return [];
    const firstRecord = records[0];
    const keys = Object.keys(firstRecord);
    const matchingKey = keys.find(k => 
      k === fieldName || 
      k === `"${fieldName}"` || 
      k === `\`${fieldName}\`` ||
      k.toLowerCase() === fieldName.toLowerCase()
    );
    const actualKey = matchingKey || fieldName;
    const values = records.map((r) => {
      const val = r[actualKey];
      return val !== null && val !== undefined ? String(val) : "";
    }).filter(Boolean);
    return values;
  };

  const serviceNames = extractValues(servicesData?.records as Record<string, unknown>[] | undefined, "entity.name");
  const clusters = extractValues(clustersData?.records as Record<string, unknown>[] | undefined, "k8s_cluster");
  const namespaces = extractValues(namespacesData?.records as Record<string, unknown>[] | undefined, "k8s_namespace");
  const workloads = extractValues(workloadsData?.records as Record<string, unknown>[] | undefined, "k8s_workload");
  const tags = extractValues(tagsData?.records as Record<string, unknown>[] | undefined, "tag");

  const handleTimeframeChange = (value: Timeframe | null) => {
    onFilterChange({
      ...filters,
      timeframe: value,
    });
  };

  // Helper to show loading or count in labels
  const getLabel = (name: string, count: number, isLoading: boolean) => {
    if (isLoading) return `${name} (loading...)`;
    return count > 0 ? `${name} (${count})` : `${name} (none)`;
  };

  return (
    <Flex flexDirection="column" gap={16}>
      {/* Debug info */}
      {servicesError && (
        <Text style={{ color: "red", fontSize: 12 }}>
          Services query error: {servicesError.message}
        </Text>
      )}
      {clustersError && (
        <Text style={{ color: "red", fontSize: 12 }}>
          Clusters query error: {clustersError.message}
        </Text>
      )}
      {servicesLoading && (
        <Text style={{ fontSize: 12 }}>Loading filter options...</Text>
      )}
      {!servicesLoading && serviceNames.length > 0 && (
        <Text style={{ fontSize: 12, color: "green" }}>
          Found {serviceNames.length} services, {clusters.length} clusters, {namespaces.length} namespaces
        </Text>
      )}
      
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Flex flexDirection="column" gap={4}>
          <Label>Timeframe</Label>
          <TimeframeSelector
            value={filters.timeframe}
            onChange={handleTimeframeChange}
          />
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Label>Max Records</Label>
          <NumberInput
            value={filters.maxRecords}
            onChange={(value) =>
              onFilterChange({ ...filters, maxRecords: value ?? 1000 })
            }
            min={100}
            max={1000000}
            style={{ width: 120 }}
          />
        </Flex>
      </Flex>

      <Flex gap={16} flexWrap="wrap">
        <Flex flexDirection="column" gap={4}>
          <Label>{getLabel("K8s Cluster", clusters.length, false)}</Label>
          <Select
            value={filters.k8sCluster}
            onChange={(value) =>
              onFilterChange({
                ...filters,
                k8sCluster: value as string | null,
                k8sNamespace: null,
                k8sWorkload: null,
                serviceTags: [],
              })
            }
            clearable
            placeholder={clusters.length > 0 ? "All clusters" : "No clusters found"}
          >
            <SelectContent>
              <SelectFilter />
              {clusters.length > 0 && <SelectOption value="">All clusters</SelectOption>}
              {clusters.map((cluster) => (
                <SelectOption key={cluster} value={cluster}>
                  {cluster}
                </SelectOption>
              ))}
            </SelectContent>
          </Select>
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Label>{getLabel("K8s Namespace", namespaces.length, false)}</Label>
          <Select
            value={filters.k8sNamespace}
            onChange={(value) =>
              onFilterChange({
                ...filters,
                k8sNamespace: value as string | null,
                k8sWorkload: null,
                serviceTags: [],
              })
            }
            clearable
            placeholder={namespaces.length > 0 ? "All namespaces" : "No namespaces found"}
          >
            <SelectContent>
              <SelectFilter />
              {namespaces.length > 0 && <SelectOption value="">All namespaces</SelectOption>}
              {namespaces.map((ns) => (
                <SelectOption key={ns} value={ns}>
                  {ns}
                </SelectOption>
              ))}
            </SelectContent>
          </Select>
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Label>{getLabel("K8s Workload", workloads.length, false)}</Label>
          <Select
            value={filters.k8sWorkload}
            onChange={(value) =>
              onFilterChange({
                ...filters,
                k8sWorkload: value as string | null,
              })
            }
            clearable
            placeholder={workloads.length > 0 ? "All workloads" : "No workloads found"}
          >
            <SelectContent>
              <SelectFilter />
              {workloads.length > 0 && <SelectOption value="">All workloads</SelectOption>}
              {workloads.map((wl) => (
                <SelectOption key={wl} value={wl}>
                  {wl}
                </SelectOption>
              ))}
            </SelectContent>
          </Select>
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Label>{getLabel("Service Tags", tags.length, tagsLoading)}</Label>
          <Select
            value={filters.serviceTags}
            onChange={(value) =>
              onFilterChange({
                ...filters,
                serviceTags: (value as string[]) || [],
              })
            }
            clearable
            placeholder={tags.length > 0 ? "Select tags" : "No tags found"}
            multiple
          >
            <SelectContent>
              <SelectFilter />
              {tags.map((tag) => (
                <SelectOption key={tag} value={tag}>
                  {tag}
                </SelectOption>
              ))}
            </SelectContent>
          </Select>
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Label>Service Name</Label>
          <TextInput
            value={filters.serviceName}
            onChange={(value) =>
              onFilterChange({ ...filters, serviceName: value })
            }
            placeholder="Filter by service name..."
          />
        </Flex>
      </Flex>
    </Flex>
  );
};
