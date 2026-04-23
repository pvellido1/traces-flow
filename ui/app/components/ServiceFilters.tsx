import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { TextInput } from "@dynatrace/strato-components-preview/forms";
import { Select, SelectOption, SelectContent } from "@dynatrace/strato-components-preview/forms";
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
  technology: string | null;
  cloudProvider: string | null;
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

  // Query for service names (most reliable field)
  const { data: servicesData, error: servicesError, isLoading: servicesLoading } = useDql({
    query: `fetch spans${timeframeClause}
| filter isNotNull(dt.service.name)
| summarize count(), by: {dt.service.name}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for K8s clusters
  const { data: clustersData, error: clustersError } = useDql({
    query: `fetch spans${timeframeClause}
| filter isNotNull(k8s.cluster.name)
| summarize count(), by: {k8s.cluster.name}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for K8s namespaces
  const namespaceFilter = filters.k8sCluster
    ? `| filter k8s.cluster.name == "${filters.k8sCluster}"`
    : "";
  const { data: namespacesData } = useDql({
    query: `fetch spans${timeframeClause}
| filter isNotNull(k8s.namespace.name)
${namespaceFilter}
| summarize count(), by: {k8s.namespace.name}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for K8s workloads
  const workloadFilters = [
    filters.k8sCluster ? `k8s.cluster.name == "${filters.k8sCluster}"` : "",
    filters.k8sNamespace
      ? `k8s.namespace.name == "${filters.k8sNamespace}"`
      : "",
  ]
    .filter(Boolean)
    .join(" AND ");
  const workloadFilterClause = workloadFilters ? `| filter ${workloadFilters}` : "";
  const { data: workloadsData } = useDql({
    query: `fetch spans${timeframeClause}
| filter isNotNull(k8s.workload.name)
${workloadFilterClause}
| summarize count(), by: {k8s.workload.name}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for technologies
  const { data: technologiesData } = useDql({
    query: `fetch spans${timeframeClause}
| filter isNotNull(telemetry.sdk.language)
| summarize count(), by: {telemetry.sdk.language}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for cloud providers
  const { data: cloudProvidersData } = useDql({
    query: `fetch spans${timeframeClause}
| filter isNotNull(cloud.provider)
| summarize count(), by: {cloud.provider}
| sort \`count()\` desc
${limitClause}`,
  });

  // Query for service tags - fetch from service entities, not spans
  const { data: tagsData, isLoading: tagsLoading } = useDql({
    query: `fetch dt.entity.service
| filter isNotNull(tags) AND arraySize(tags) > 0
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

  const serviceNames = extractValues(servicesData?.records as Record<string, unknown>[] | undefined, "dt.service.name");
  const clusters = extractValues(clustersData?.records as Record<string, unknown>[] | undefined, "k8s.cluster.name");
  const namespaces = extractValues(namespacesData?.records as Record<string, unknown>[] | undefined, "k8s.namespace.name");
  const workloads = extractValues(workloadsData?.records as Record<string, unknown>[] | undefined, "k8s.workload.name");
  const technologies = extractValues(technologiesData?.records as Record<string, unknown>[] | undefined, "telemetry.sdk.language");
  const cloudProviders = extractValues(cloudProvidersData?.records as Record<string, unknown>[] | undefined, "cloud.provider");
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
          Query error: {servicesError.message}
        </Text>
      )}
      {servicesLoading && (
        <Text style={{ fontSize: 12 }}>Loading filter options...</Text>
      )}
      {!servicesLoading && serviceNames.length > 0 && (
        <Text style={{ fontSize: 12, color: "green" }}>
          Found {serviceNames.length} services in the selected timeframe
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
              })
            }
            clearable
            placeholder={clusters.length > 0 ? "All clusters" : "No clusters found"}
          >
            <SelectContent>
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
              })
            }
            clearable
            placeholder={namespaces.length > 0 ? "All namespaces" : "No namespaces found"}
          >
            <SelectContent>
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
          <Label>{getLabel("Technology", technologies.length, false)}</Label>
          <Select
            value={filters.technology}
            onChange={(value) =>
              onFilterChange({
                ...filters,
                technology: value as string | null,
              })
            }
            clearable
            placeholder={technologies.length > 0 ? "All technologies" : "No technologies found"}
          >
            <SelectContent>
              {technologies.length > 0 && <SelectOption value="">All technologies</SelectOption>}
              {technologies.map((tech) => (
                <SelectOption key={tech} value={tech}>
                  {tech}
                </SelectOption>
              ))}
            </SelectContent>
          </Select>
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Label>{getLabel("Cloud Provider", cloudProviders.length, false)}</Label>
          <Select
            value={filters.cloudProvider}
            onChange={(value) =>
              onFilterChange({
                ...filters,
                cloudProvider: value as string | null,
              })
            }
            clearable
            placeholder={cloudProviders.length > 0 ? "All providers" : "No providers found"}
          >
            <SelectContent>
              {cloudProviders.length > 0 && <SelectOption value="">All providers</SelectOption>}
              {cloudProviders.map((cp) => (
                <SelectOption key={cp} value={cp}>
                  {cp}
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
