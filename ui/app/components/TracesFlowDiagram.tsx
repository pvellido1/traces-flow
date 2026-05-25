import React, { useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { ToggleButtonGroup, Select, SelectOption } from "@dynatrace/strato-components/forms";
import { Button } from "@dynatrace/strato-components/buttons";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { PlusIcon, MinusIcon } from "@dynatrace/strato-icons";
import { ServiceData } from "./ServicesTable";
import { FilterValues } from "./ServiceFilters";

// Theme-aware colors inspired by Dynatrace service flow
const LightColors = {
  node: {
    background: "#ffffff",
    border: "#d0d1dc",
    borderHover: "#474fcf",
    borderSelected: "#10b981",
    targetBg: "#e8f5e9",
    targetBorder: "#2f6862",
    filterMatchBg: "#fff7ed",
    filterMatchBorder: "#f97316",
  },
  link: {
    default: "#7b8ab8",
    hover: "#474fcf",
    selected: "#10b981",
  },
  text: {
    primary: "#2d2e4e",
    secondary: "#5b5c81",
    accent: "#474fcf",
  },
  progress: {
    bar: "#474fcf",
    bg: "#e4e5eb",
  },
  container: {
    border: "#e4e5eb",
    background: "#f8f9fa",
  },
  label: {
    background: "#ffffff",
    border: "#e4e5eb",
  },
};

const DarkColors = {
  node: {
    background: "#1e1e2e",
    border: "#4a4a5a",
    borderHover: "#7c7cff",
    borderSelected: "#34d399",
    targetBg: "#1a3333",
    targetBorder: "#4ade80",
    filterMatchBg: "#431407",
    filterMatchBorder: "#fb923c",
  },
  link: {
    default: "#6b7aa8",
    hover: "#7c7cff",
    selected: "#34d399",
  },
  text: {
    primary: "#e4e4e7",
    secondary: "#a1a1aa",
    accent: "#7c7cff",
  },
  progress: {
    bar: "#7c7cff",
    bg: "#3f3f46",
  },
  container: {
    border: "#3f3f46",
    background: "#18181b",
  },
  label: {
    background: "#27272a",
    border: "#3f3f46",
  },
};

interface TracesFlowDiagramProps {
  service: ServiceData;
  filters: FilterValues;
  onPathSelect: (path: string[]) => void;
  selectedPath: string[] | null;
}

// Tree node for the flow visualization
interface TreeNode {
  id: string;
  serviceName: string;
  serviceId: string | null; // Service entity ID for matching
  endpointName: string | null; // For endpoint view mode
  displayName: string; // What to show as main text
  level: number;
  callCount: number;
  callPercentage: number;
  children: Map<string, TreeNode>;
  y: number;
  height: number;
  pathKey: string;
}

export const TracesFlowDiagram: React.FC<TracesFlowDiagramProps> = ({
  service,
  filters,
  onPathSelect,
  selectedPath,
}) => {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"service" | "endpoint">("service");
  const [nodeFilter, setNodeFilter] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const theme = useCurrentTheme();

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.1, 2));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.1, 0.3));
  const handleZoomReset = () => setZoom(1);
  const Colors = theme === "dark" ? DarkColors : LightColors;

  // Build timeframe for DQL
  const getTimeframeParam = () => {
    if (!filters.timeframe) return "";
    if (filters.timeframe.from.type === "expression") {
      return `, from: ${filters.timeframe.from.value}, to: ${filters.timeframe.to.value}`;
    }
    return `, from: timestamp("${filters.timeframe.from.absoluteDate}"), to: timestamp("${filters.timeframe.to.absoluteDate}")`;
  };

  const timeframeClause = getTimeframeParam();

  // Calculate limits - DQL has a max of ~1 million records
  // We need ~50-100 spans per trace for hierarchy
  const maxTraces = filters.maxRecords || 500;
  const maxSpans = Math.min(maxTraces * 100, 1000000); // Cap at 1M spans

  // Single query: fetch ALL spans for traces that contain the selected service
  // Uses lookup to first identify relevant trace IDs, then fetches complete hierarchy
  // Filter by service entity ID (dt.smartscape.service) which is more reliable than name
  const orderQuery = `fetch spans${timeframeClause}
| filter isNotNull(trace.id)
| lookup [
    fetch spans${timeframeClause}
    | filter dt.smartscape.service == "${service.serviceId}"
    | summarize count(), by: {trace.id}
    | limit ${maxTraces}
  ], sourceField: trace.id, lookupField: trace.id, prefix: "match_"
| filter isNotNull(match_trace.id)
| fields trace.id, span.id, span.parent_id, dt.service.name, dt.smartscape.service, endpoint.name, span.name, start_time
| sort trace.id, start_time asc
| limit ${maxSpans}`;

  const { data: orderData, isLoading: orderLoading, error: orderError } = useDql({ 
    query: orderQuery,
    maxResultRecords: maxSpans 
  });

  // Collect unique service names for filtering
  const uniqueServices = useMemo(() => {
    if (!orderData?.records || orderData.records.length === 0) {
      return [];
    }
    const serviceSet = new Set<string>();
    orderData.records.forEach((record) => {
      const rawServiceName = record["dt.service.name"];
      if (rawServiceName) {
        serviceSet.add(String(rawServiceName));
      }
    });
    return Array.from(serviceSet).sort();
  }, [orderData]);

  // Collect unique endpoint names for filtering
  const uniqueEndpoints = useMemo(() => {
    if (!orderData?.records || orderData.records.length === 0) {
      return [];
    }
    const endpointSet = new Set<string>();
    orderData.records.forEach((record) => {
      const rawEndpointName = record["endpoint.name"];
      const rawSpanName = record["span.name"];
      const effectiveEndpoint = rawEndpointName ? String(rawEndpointName) : (rawSpanName ? String(rawSpanName) : null);
      if (effectiveEndpoint) {
        endpointSet.add(effectiveEndpoint);
      }
    });
    return Array.from(endpointSet).sort();
  }, [orderData]);

  // Get filter options based on view mode
  const filterOptions = viewMode === "service" ? uniqueServices : uniqueEndpoints;

  // Build tree structure from trace data
  const { flatNodes, flatLinks, totalTraces, maxLevel } = useMemo(() => {
    if (!orderData?.records || orderData.records.length === 0) {
      return { flatNodes: [], flatLinks: [], totalTraces: 0, maxLevel: 0 };
    }

    // Group spans by trace.id and build service order from parent-child hierarchy
    interface SpanInfo {
      spanId: string;
      parentId: string | null;
      serviceName: string | null;  // null for spans without service (internal, some clients)
      serviceId: string | null;    // Service entity ID for matching
      endpointName: string | null; // endpoint.name or span.name as fallback
      startTime: string;
    }
    
    const traceSpans = new Map<string, SpanInfo[]>();
    
    // Group spans by trace
    orderData.records.forEach((record) => {
      const traceId = String(record["trace.id"]);
      const rawServiceName = record["dt.service.name"];
      const rawServiceId = record["dt.smartscape.service"];
      const rawEndpointName = record["endpoint.name"];
      const rawSpanName = record["span.name"];
      // Use endpoint.name if available, otherwise fall back to span.name
      const effectiveEndpoint = rawEndpointName ? String(rawEndpointName) : (rawSpanName ? String(rawSpanName) : null);
      const span: SpanInfo = {
        spanId: String(record["span.id"] || ""),
        parentId: record["span.parent_id"] ? String(record["span.parent_id"]) : null,
        serviceName: rawServiceName ? String(rawServiceName) : null,
        serviceId: rawServiceId ? String(rawServiceId) : null,
        endpointName: effectiveEndpoint,
        startTime: String(record["start_time"] || ""),
      };
      
      if (!traceSpans.has(traceId)) {
        traceSpans.set(traceId, []);
      }
      traceSpans.get(traceId)!.push(span);
    });

    // Query already filtered for traces containing the service via lookup
    // Filter by service or endpoint if selected, then limit to maxRecords
    let filteredTraces = Array.from(traceSpans.entries());
    
    // If filter is set, only include traces that contain that service/endpoint
    if (nodeFilter) {
      if (viewMode === "service") {
        filteredTraces = filteredTraces.filter(([_, spans]) => 
          spans.some(span => span.serviceName === nodeFilter)
        );
      } else {
        filteredTraces = filteredTraces.filter(([_, spans]) => 
          spans.some(span => span.endpointName === nodeFilter)
        );
      }
    }
    
    const limitedTraces = filteredTraces.slice(0, filters.maxRecords || 500);
    const totalTraces = limitedTraces.length;

    let nodeIdCounter = 0;
    const rootChildren = new Map<string, TreeNode>();
    let maxLevel = 0;

    // Node info for building the tree
    interface NodeInfo {
      key: string; // Unique key for grouping
      displayName: string; // What to show as main label
      serviceName: string;
      serviceId: string | null; // Service entity ID for matching
      endpointName: string | null;
    }

    // Build order from parent-child hierarchy for each trace using DFS
    // This ensures children appear immediately after their parent in the call sequence
    const buildOrderFromHierarchy = (spans: SpanInfo[]): NodeInfo[] => {
      // Build a map of spanId -> span and parentId -> children
      const spanMap = new Map<string, SpanInfo>();
      const childrenMap = new Map<string | null, SpanInfo[]>();
      
      spans.forEach(span => {
        spanMap.set(span.spanId, span);
        if (!childrenMap.has(span.parentId)) {
          childrenMap.set(span.parentId, []);
        }
        childrenMap.get(span.parentId)!.push(span);
      });

      // Find root spans (those whose parent is not in our span set, or parent is null)
      const rootSpans = spans.filter(span => 
        span.parentId === null || !spanMap.has(span.parentId)
      );

      // Sort roots by span.id for deterministic ordering (not by time)
      rootSpans.sort((a, b) => a.spanId.localeCompare(b.spanId));

      // DFS traversal to follow the actual call hierarchy
      // Children appear immediately after their parent in the sequence
      const nodeOrder: NodeInfo[] = [];
      const visited = new Set<string>();
      const seenKeys = new Set<string>();

      const processSpan = (span: SpanInfo) => {
        if (visited.has(span.spanId)) return;
        visited.add(span.spanId);

        // Build the node info based on view mode
        if (viewMode === "endpoint") {
          // For endpoint mode: use endpoint+service as key
          if (span.endpointName && span.serviceName) {
            const key = `${span.endpointName}@${span.serviceName}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              nodeOrder.push({
                key,
                displayName: span.endpointName,
                serviceName: span.serviceName,
                serviceId: span.serviceId,
                endpointName: span.endpointName,
              });
            } else if (span.serviceId) {
              // Update serviceId if we have one now but didn't before
              const existingNode = nodeOrder.find(n => n.key === key);
              if (existingNode && !existingNode.serviceId) {
                existingNode.serviceId = span.serviceId;
              }
            }
          } else if (span.serviceName) {
            // Fallback: span has service but no endpoint
            const key = `(no endpoint)@${span.serviceName}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              nodeOrder.push({
                key,
                displayName: "(no endpoint)",
                serviceName: span.serviceName,
                serviceId: span.serviceId,
                endpointName: null,
              });
            } else if (span.serviceId) {
              const existingNode = nodeOrder.find(n => n.key === key);
              if (existingNode && !existingNode.serviceId) {
                existingNode.serviceId = span.serviceId;
              }
            }
          }
        } else {
          // Service mode: use service name as key
          if (span.serviceName) {
            if (!seenKeys.has(span.serviceName)) {
              seenKeys.add(span.serviceName);
              nodeOrder.push({
                key: span.serviceName,
                displayName: span.serviceName,
                serviceName: span.serviceName,
                serviceId: span.serviceId,
                endpointName: null,
              });
            } else if (span.serviceId) {
              // Update serviceId if we have one now but didn't before
              const existingNode = nodeOrder.find(n => n.key === span.serviceName);
              if (existingNode && !existingNode.serviceId) {
                existingNode.serviceId = span.serviceId;
              }
            }
          }
        }

        // Process children immediately after parent (DFS)
        // Sort siblings by span.id for deterministic ordering
        const children = childrenMap.get(span.spanId) || [];
        children.sort((a, b) => a.spanId.localeCompare(b.spanId));
        children.forEach(child => processSpan(child));
      };

      // Start DFS from each root span
      rootSpans.forEach(root => processSpan(root));

      return nodeOrder;
    };

    // Process each trace to build the tree
    limitedTraces.forEach(([traceId, spans], idx) => {
      const nodeInfos = buildOrderFromHierarchy(spans);
      
      if (nodeInfos.length === 0) return;
      
      maxLevel = Math.max(maxLevel, nodeInfos.length - 1);
      
      // Walk down the tree, creating nodes as needed
      let currentLevel = rootChildren;
      
      nodeInfos.forEach((info, idx) => {
        if (!currentLevel.has(info.key)) {
          currentLevel.set(info.key, {
            id: `node-${nodeIdCounter++}`,
            serviceName: info.serviceName,
            serviceId: info.serviceId,
            endpointName: info.endpointName,
            displayName: info.displayName,
            level: idx,
            callCount: 0,
            callPercentage: 0,
            children: new Map(),
            y: 0,
            height: 0,
            pathKey: nodeInfos.slice(0, idx + 1).map(n => n.key).join("|"),
          });
        }
        
        const node = currentLevel.get(info.key)!;
        node.callCount++;
        node.callPercentage = (node.callCount / totalTraces) * 100;
        
        currentLevel = node.children;
      });
    });

    // Flatten the tree for rendering
    const flatNodes: Array<{
      id: string;
      serviceName: string;
      serviceId: string | null;
      endpointName: string | null;
      displayName: string;
      level: number;
      callCount: number;
      callPercentage: number;
      x: number;
      y: number;
      width: number;
      height: number;
      pathKey: string;
      hasChildren: boolean;
    }> = [];

    const flatLinks: Array<{
      sourceId: string;
      targetId: string;
      sourceX: number;
      sourceY: number;
      targetX: number;
      targetY: number;
      callCount: number;
      percentage: number;
      thickness: number;
    }> = [];

    const nodeWidth = 220;
    // Taller nodes for endpoint view to fit both endpoint name and service name
    const nodeHeight = viewMode === "endpoint" ? 95 : 80;
    const levelGap = 200;
    const nodeGap = 15;
    const paddingX = 50;
    const paddingY = 30;

    // Recursive function to layout nodes
    const layoutSubtree = (
      children: Map<string, TreeNode>,
      startY: number,
      parentId: string | null,
      parentX: number,
      parentY: number
    ): number => {
      let currentY = startY;
      
      children.forEach((node) => {
        const x = paddingX + node.level * (nodeWidth + levelGap);
        
        // First, layout all children to know total height
        let childrenHeight = 0;
        if (node.children.size > 0) {
          childrenHeight = layoutSubtree(
            node.children,
            currentY,
            node.id,
            x + nodeWidth,
            0 // Will be updated
          );
        }

        // Position this node in the middle of its children, or at currentY if no children
        const subtreeHeight = Math.max(nodeHeight, childrenHeight);
        const y = currentY + (subtreeHeight - nodeHeight) / 2;

        flatNodes.push({
          id: node.id,
          serviceName: node.serviceName,
          serviceId: node.serviceId,
          endpointName: node.endpointName,
          displayName: node.displayName,
          level: node.level,
          callCount: node.callCount,
          callPercentage: node.callPercentage,
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
          pathKey: node.pathKey,
          hasChildren: node.children.size > 0,
        });

        // Update parent link y position
        if (parentId) {
          const linkIdx = flatLinks.findIndex(l => l.targetId === node.id);
          if (linkIdx >= 0) {
            flatLinks[linkIdx].targetY = y + nodeHeight / 2;
          }
        }

        // Create link from parent
        if (parentId) {
          flatLinks.push({
            sourceId: parentId,
            targetId: node.id,
            sourceX: parentX,
            sourceY: parentY,
            targetX: x,
            targetY: y + nodeHeight / 2,
            callCount: node.callCount,
            percentage: node.callPercentage,
            thickness: Math.max(2, Math.min(20, (node.callPercentage / 100) * 20)),
          });
        }

        currentY += subtreeHeight + nodeGap;
      });

      return currentY - startY - nodeGap;
    };

    // Layout starting from root
    layoutSubtree(rootChildren, paddingY, null, 0, 0);

    // Fix link source positions after all nodes are laid out
    flatLinks.forEach(link => {
      const sourceNode = flatNodes.find(n => n.id === link.sourceId);
      if (sourceNode) {
        link.sourceX = sourceNode.x + sourceNode.width;
        link.sourceY = sourceNode.y + sourceNode.height / 2;
      }
    });

    return { flatNodes, flatLinks, totalTraces, maxLevel };
  }, [orderData, viewMode, filters.maxRecords, nodeFilter]);

  // Calculate SVG dimensions
  const svgWidth = flatNodes.length > 0 
    ? Math.max(...flatNodes.map(n => n.x + n.width)) + 50
    : 800;
  const svgHeight = flatNodes.length > 0
    ? Math.max(...flatNodes.map(n => n.y + n.height)) + 50
    : 400;

  const isNodeSelected = (pathKey: string) => {
    if (!selectedPath || selectedPath.length === 0) return false;
    const selectedKey = selectedPath.join("|");
    return pathKey === selectedKey || selectedKey.startsWith(pathKey + "|");
  };

  if (orderLoading) {
    return (
      <Flex justifyContent="center" padding={32}>
        <ProgressCircle />
      </Flex>
    );
  }

  if (orderError) {
    return (
      <Flex padding={16}>
        <Text>Error loading trace flows: {orderError.message}</Text>
      </Flex>
    );
  }

  if (flatNodes.length === 0) {
    return (
      <Flex padding={16}>
        <Text>No trace flow data found for this service.</Text>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" gap={16}>
      <Flex justifyContent="space-between" alignItems="center">
        <Flex alignItems="center" gap={16}>
          <Heading level={3}>Service Flow - {service.serviceName}</Heading>
          <ToggleButtonGroup 
            value={viewMode} 
            onChange={(value: string) => {
              setViewMode(value as "service" | "endpoint");
              setNodeFilter(null); // Clear filter when switching views
              onPathSelect([]); // Clear selection when switching views
            }}
          >
            <ToggleButtonGroup.Item value="service">By Service</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="endpoint">By Endpoint</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
          <div style={{ minWidth: 300 }}>
            <Select<string>
              value={nodeFilter}
              onChange={(value) => {
                setNodeFilter(value);
                onPathSelect([]); // Clear selection when filter changes
              }}
              clearable
            >
              <Select.Filter />
              <Select.Content style={{ maxHeight: 300, minWidth: 350 }}>
                {filterOptions.map((option) => (
                  <SelectOption key={option} value={option}>
                    {option}
                  </SelectOption>
                ))}
              </Select.Content>
            </Select>
          </div>
        </Flex>
        <Text style={{ fontSize: 12, color: Colors.text.secondary }}>
          {totalTraces} traces analyzed{nodeFilter ? ` (filtered)` : ""} · Click a {viewMode === "endpoint" ? "endpoint" : "service"} to select path
        </Text>
      </Flex>

      {/* Scrollable container */}
      <div
        style={{
          overflowX: "auto",
          overflowY: "auto",
          maxHeight: "65vh",
          border: `1px solid ${Colors.container.border}`,
          borderRadius: 8,
          backgroundColor: Colors.container.background,
          position: "relative",
        }}
      >
        {/* Zoom controls */}
        <Flex
          gap={4}
          style={{
            position: "sticky",
            top: 8,
            left: 8,
            zIndex: 10,
            padding: 4,
            background: Colors.label.background,
            borderRadius: 6,
            border: `1px solid ${Colors.label.border}`,
            width: "fit-content",
            marginBottom: -40,
          }}
        >
          <Button variant="default" color="neutral" onClick={handleZoomOut} aria-label="Zoom out">
            <MinusIcon />
          </Button>
          <Button variant="default" color="neutral" onClick={handleZoomReset} style={{ minWidth: 50, fontSize: 12 }}>
            {Math.round(zoom * 100)}%
          </Button>
          <Button variant="default" color="neutral" onClick={handleZoomIn} aria-label="Zoom in">
            <PlusIcon />
          </Button>
        </Flex>
        <svg
          width={Math.max(svgWidth, 800) * zoom}
          height={Math.max(svgHeight, 400) * zoom}
          style={{ display: "block" }}
        >
          <g transform={`scale(${zoom})`}>
          {/* Links */}
          {flatLinks.map((link, idx) => {
            const targetNode = flatNodes.find(n => n.id === link.targetId);
            const isSelected = targetNode ? isNodeSelected(targetNode.pathKey) : false;
            const midX = (link.sourceX + link.targetX) / 2;

            return (
              <g key={`link-${idx}`}>
                {/* Bezier curve */}
                <path
                  d={`M ${link.sourceX} ${link.sourceY} 
                      C ${midX} ${link.sourceY}, 
                        ${midX} ${link.targetY}, 
                        ${link.targetX} ${link.targetY}`}
                  fill="none"
                  stroke={isSelected ? Colors.link.selected : Colors.link.default}
                  strokeWidth={link.thickness}
                  opacity={isSelected ? 1 : 0.5}
                />
                {/* Percentage label */}
                <g transform={`translate(${midX - 35}, ${(link.sourceY + link.targetY) / 2 - 12})`}>
                  <rect x={0} y={0} width={70} height={20} rx={4} fill={Colors.label.background} stroke={Colors.label.border} />
                  <text x={35} y={14} textAnchor="middle" fontSize={10} fill={Colors.text.secondary}>
                    {link.percentage.toFixed(1)}% call
                  </text>
                </g>
              </g>
            );
          })}

          {/* Nodes */}
          {flatNodes.map((node) => {
            // Match by serviceId (preferred) or serviceName (fallback)
            const isTarget = (node.serviceId && node.serviceId === service.serviceId) || 
                             node.serviceName === service.serviceName;
            // Check if node matches the filter selection
            const isFilterMatch = nodeFilter ? (
              viewMode === "service" 
                ? node.serviceName === nodeFilter
                : node.endpointName === nodeFilter || `${node.endpointName}@${node.serviceName}` === nodeFilter
            ) : false;
            const isSelected = isNodeSelected(node.pathKey);
            const isHovered = hoveredNode === node.id;
            const progressWidth = Math.min(100, node.callPercentage);
            
            // Y positions for text elements based on view mode
            const nameY = viewMode === "endpoint" ? 20 : 22;
            const serviceY = viewMode === "endpoint" ? 35 : 0; // Only used in endpoint mode
            const percentY = viewMode === "endpoint" ? 52 : 40;
            const progressY = viewMode === "endpoint" ? 60 : 48;
            const countY = viewMode === "endpoint" ? 80 : 68;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onPathSelect(node.pathKey.split("|"))}
              >
                {/* Shadow */}
                <rect
                  x={2}
                  y={2}
                  width={node.width}
                  height={node.height}
                  rx={6}
                  fill="rgba(0,0,0,0.08)"
                />
                {/* Node background */}
                <rect
                  x={0}
                  y={0}
                  width={node.width}
                  height={node.height}
                  rx={6}
                  fill={
                    isTarget ? Colors.node.targetBg 
                    : isFilterMatch ? Colors.node.filterMatchBg 
                    : Colors.node.background
                  }
                  stroke={
                    isSelected ? Colors.node.borderSelected
                    : isHovered ? Colors.node.borderHover
                    : isTarget ? Colors.node.targetBorder
                    : isFilterMatch ? Colors.node.filterMatchBorder
                    : Colors.node.border
                  }
                  strokeWidth={isSelected || isHovered || isFilterMatch ? 2 : 1}
                />
                {/* Left accent bar */}
                <rect
                  x={0}
                  y={0}
                  width={4}
                  height={node.height}
                  rx={2}
                  fill={
                    isTarget ? Colors.node.targetBorder 
                    : isFilterMatch ? Colors.node.filterMatchBorder 
                    : Colors.text.accent
                  }
                />
                {/* Main name (endpoint name in endpoint mode, service name in service mode) */}
                <text x={15} y={nameY} fontSize={12} fontWeight={600} fill={Colors.text.primary}>
                  {node.displayName.length > 26 ? node.displayName.substring(0, 23) + "..." : node.displayName}
                </text>
                <title>{viewMode === "endpoint" ? `${node.displayName}\n${node.serviceName}` : node.serviceName}</title>
                {/* Service name (only in endpoint mode) */}
                {viewMode === "endpoint" && (
                  <text x={15} y={serviceY} fontSize={10} fill={Colors.text.secondary}>
                    {node.serviceName.length > 30 ? node.serviceName.substring(0, 27) + "..." : node.serviceName}
                  </text>
                )}
                {/* Percentage text */}
                <text x={15} y={percentY} fontSize={10} fill={Colors.text.secondary}>
                  {node.callPercentage.toFixed(1)}% of traces
                </text>
                {/* Progress bar bg */}
                <rect x={15} y={progressY} width={node.width - 30} height={6} rx={3} fill={Colors.progress.bg} />
                {/* Progress bar */}
                <rect
                  x={15}
                  y={progressY}
                  width={((node.width - 30) * progressWidth) / 100}
                  height={6}
                  rx={3}
                  fill={isTarget ? Colors.node.targetBorder : Colors.progress.bar}
                />
                {/* Trace count */}
                <text x={15} y={countY} fontSize={9} fill={Colors.text.secondary}>
                  {node.callCount.toLocaleString()} traces
                </text>
                {/* Children indicator */}
                {node.hasChildren && (
                  <text x={node.width - 15} y={node.height / 2 + 4} fontSize={14} fill={Colors.text.secondary}>
                    {">"}
                  </text>
                )}
              </g>
            );
          })}
          </g>
        </svg>
      </div>
    </Flex>
  );
};
