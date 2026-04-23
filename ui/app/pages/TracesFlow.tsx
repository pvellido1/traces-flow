import React, { useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Surface } from "@dynatrace/strato-components/layouts";
import { Divider } from "@dynatrace/strato-components/layouts";
import { ServiceFilters, FilterValues } from "../components/ServiceFilters";
import { ServicesTable, ServiceData } from "../components/ServicesTable";
import { TracesFlowDiagram } from "../components/TracesFlowDiagram";
import { TracesTable } from "../components/TracesTable";
import { ArrowLeftIcon } from "@dynatrace/strato-icons";

const getDefaultTimeframe = () => {
  return {
    from: {
      absoluteDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      value: "now() - 2h",
      type: "expression" as const,
    },
    to: {
      absoluteDate: new Date().toISOString(),
      value: "now()",
      type: "expression" as const,
    },
  };
};

export const TracesFlow: React.FC = () => {
  const [filters, setFilters] = useState<FilterValues>({
    k8sCluster: null,
    k8sNamespace: null,
    k8sWorkload: null,
    serviceTags: [],
    technology: null,
    cloudProvider: null,
    serviceName: "",
    timeframe: getDefaultTimeframe(),
    maxRecords: 1000,
  });

  const [selectedService, setSelectedService] = useState<ServiceData | null>(null);
  const [selectedPath, setSelectedPath] = useState<string[] | null>(null);

  const handleViewTracesFlow = (service: ServiceData) => {
    setSelectedService(service);
    setSelectedPath(null);
  };

  const handlePathSelect = (path: string[]) => {
    setSelectedPath(path);
  };

  const handleBackToServices = () => {
    setSelectedService(null);
    setSelectedPath(null);
  };

  return (
    <Flex flexDirection="column" padding={24} gap={24}>
      <Flex flexDirection="column" gap={8}>
        <Heading level={1}>Traces Flow</Heading>
      </Flex>

      {/* Service Selection Section - only show when no service selected */}
      {!selectedService && (
        <>
          <Surface>
            <Flex flexDirection="column" padding={16} gap={16}>
              <Heading level={4}>Select Service</Heading>
              <ServiceFilters filters={filters} onFilterChange={setFilters} />
            </Flex>
          </Surface>
          <Divider />
        </>
      )}

      {/* Main Content */}
      {selectedService ? (
        // Service Selected - Show Traces Flow Diagram
        <Flex flexDirection="column" gap={24}>
          <Button variant="emphasized" color="neutral" onClick={handleBackToServices}>
            <Button.Prefix>
              <ArrowLeftIcon />
            </Button.Prefix>
            Back to Services
          </Button>

          <Surface>
            <Flex flexDirection="column" padding={16}>
              <TracesFlowDiagram
                service={selectedService}
                filters={filters}
                onPathSelect={handlePathSelect}
                selectedPath={selectedPath}
              />
            </Flex>
          </Surface>

          {selectedPath && (
            <Surface>
              <Flex flexDirection="column" padding={16}>
                <TracesTable 
                  path={selectedPath} 
                  filters={filters} 
                  rootService={selectedService.serviceName}
                />
              </Flex>
            </Surface>
          )}
        </Flex>
      ) : (
        // No Service Selected - Show Services Table
        <Surface>
          <Flex flexDirection="column" padding={16}>
            <ServicesTable
              filters={filters}
              onViewTracesFlow={handleViewTracesFlow}
            />
          </Flex>
        </Surface>
      )}
    </Flex>
  );
};
