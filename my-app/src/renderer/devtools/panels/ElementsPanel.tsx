import React, { useState, useEffect, useCallback } from 'react';

interface CdpPanelProps {
  sendCdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  subscribeCdp: (listener: (method: string, params: unknown) => void) => () => void;
}

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  localName: string;
  nodeValue: string;
  attributes?: string[];
  children?: DomNode[];
  childNodeCount?: number;
}

interface MatchedStyle {
  selector: string;
  properties: Array<{ name: string; value: string }>;
}

interface ParsedAttrs {
  [key: string]: string;
}

function parseAttributes(attrs?: string[]): ParsedAttrs {
  if (!attrs) return {};
  const result: ParsedAttrs = {};
  for (let i = 0; i < attrs.length; i += 2) {
    result[attrs[i]] = attrs[i + 1];
  }
  return result;
}

export function ElementsPanel({ sendCdp, subscribeCdp }: CdpPanelProps): React.ReactElement {
  const [rootNode, setRootNode] = useState<DomNode | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [styles, setStyles] = useState<MatchedStyle[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocument = useCallback(async () => {
    console.log('[ElementsPanel] fetching DOM document');
    setLoading(true);
    try {
      await sendCdp('DOM.enable');
      await sendCdp('CSS.enable');

      const result = (await sendCdp('DOM.getDocument', { depth: 4 })) as {
        root?: DomNode;
      };

      if (result?.root) {
        console.log('[ElementsPanel] got DOM root, nodeId:', result.root.nodeId);
        setRootNode(result.root);

        const initialExpanded = new Set<number>();
        const expandFirst = (node: DomNode, depth: number): void => {
          if (depth > 2) return;
          initialExpanded.add(node.nodeId);
          node.children?.forEach((c) => expandFirst(c, depth + 1));
        };
        expandFirst(result.root, 0);
        setExpandedNodes(initialExpanded);
      }
    } catch (err) {
      console.error('[ElementsPanel] fetchDocument failed:', err);
    } finally {
      setLoading(false);
    }
  }, [sendCdp]);

  useEffect(() => {
    void fetchDocument();

    const unsubscribe = subscribeCdp((method, params) => {
      const p = params as Record<string, unknown>;

      if (method === 'DOM.childNodeInserted' || method === 'DOM.childNodeRemoved') {
        console.log('[ElementsPanel] DOM mutation:', method, p);
        void fetchDocument();
      }
    });

    return () => {
      unsubscribe();
      void sendCdp('DOM.disable').catch(() => {});
      void sendCdp('CSS.disable').catch(() => {});
    };
  }, [fetchDocument, sendCdp, subscribeCdp]);

  const handleSelectNode = useCallback(
    async (nodeId: number) => {
      setSelectedNodeId(nodeId);
      console.log('[ElementsPanel] selected node:', nodeId);

      try {
        const result = (await sendCdp('CSS.getMatchedStylesForNode', { nodeId })) as {
          matchedCSSRules?: Array<{
            rule?: {
              selectorList?: { text?: string };
              style?: {
                cssProperties?: Array<{ name: string; value: string; disabled?: boolean }>;
              };
            };
          }>;
        };

        const matched: MatchedStyle[] = [];
        if (result?.matchedCSSRules) {
          for (const entry of result.matchedCSSRules) {
            const rule = entry.rule;
            if (!rule?.style?.cssProperties) continue;
            matched.push({
              selector: rule.selectorList?.text ?? '(inline)',
              properties: rule.style.cssProperties
                .filter((p) => !p.disabled && p.value)
                .slice(0, 20)
                .map((p) => ({ name: p.name, value: p.value })),
            });
          }
        }
        setStyles(matched.slice(0, 10));
      } catch (err) {
        console.warn('[ElementsPanel] getMatchedStyles failed:', err);
        setStyles([]);
      }
    },
    [sendCdp],
  );

  const toggleExpand = useCallback(
    async (nodeId: number) => {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });

      try {
        await sendCdp('DOM.requestChildNodes', { nodeId, depth: 2 });
      } catch {
        // Children may already be loaded
      }
    },
    [sendCdp],
  );

  const renderNode = (node: DomNode, depth: number): React.ReactElement | null => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').trim();
      if (!text) return null;
      return (
        <div
          key={node.nodeId}
          className="elements-node"
          style={{ paddingLeft: depth * 16 }}
        >
          <span className="elements-text-content">
            {text.length > 120 ? text.slice(0, 120) + '...' : text}
          </span>
        </div>
      );
    }

    if (node.nodeType === 8) {
      return (
        <div
          key={node.nodeId}
          className="elements-node"
          style={{ paddingLeft: depth * 16 }}
        >
          <span className="elements-comment">
            {'<!-- ' + (node.nodeValue ?? '').slice(0, 80) + ' -->'}
          </span>
        </div>
      );
    }

    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 10) {
      return null;
    }

    const hasChildren = (node.children && node.children.length > 0) || (node.childNodeCount ?? 0) > 0;
    const isExpanded = expandedNodes.has(node.nodeId);
    const attrs = parseAttributes(node.attributes);
    const tagName = node.localName || node.nodeName?.toLowerCase() || '';

    if (node.nodeType === 9) {
      return (
        <React.Fragment key={node.nodeId}>
          {isExpanded && node.children?.map((c) => renderNode(c, depth))}
        </React.Fragment>
      );
    }

    if (node.nodeType === 10) {
      return (
        <div
          key={node.nodeId}
          className="elements-node"
          style={{ paddingLeft: depth * 16 }}
        >
          <span className="elements-comment">
            {'<!DOCTYPE ' + node.nodeName + '>'}
          </span>
        </div>
      );
    }

    return (
      <React.Fragment key={node.nodeId}>
        <div
          className="elements-node"
          data-selected={selectedNodeId === node.nodeId ? 'true' : 'false'}
          style={{ paddingLeft: depth * 16 }}
          onClick={() => void handleSelectNode(node.nodeId)}
        >
          {hasChildren ? (
            <span
              className="elements-toggle"
              onClick={(e) => {
                e.stopPropagation();
                void toggleExpand(node.nodeId);
              }}
            >
              {isExpanded ? '▾' : '▸'}
            </span>
          ) : (
            <span className="elements-toggle"> </span>
          )}
          <span className="elements-tag">{'<'}{tagName}</span>
          {Object.entries(attrs).map(([name, value]) => (
            <span key={name}>
              {' '}
              <span className="elements-attr-name">{name}</span>
              {'="'}
              <span className="elements-attr-value">{value.length > 60 ? value.slice(0, 60) + '...' : value}</span>
              {'"'}
            </span>
          ))}
          <span className="elements-tag">{'>'}</span>
          {!hasChildren && <span className="elements-tag">{'</'}{tagName}{'>'}</span>}
        </div>
        {isExpanded && node.children?.map((child) => renderNode(child, depth + 1))}
        {isExpanded && hasChildren && (
          <div
            className="elements-node"
            style={{ paddingLeft: depth * 16 }}
          >
            <span className="elements-toggle"> </span>
            <span className="elements-tag">{'</'}{tagName}{'>'}</span>
          </div>
        )}
      </React.Fragment>
    );
  };

  if (loading) {
    return (
      <div className="panel-placeholder">
        <div className="panel-placeholder-title">Loading DOM...</div>
      </div>
    );
  }

  return (
    <div className="elements-panel">
      <div className="elements-tree">
        {rootNode ? renderNode(rootNode, 0) : (
          <div className="panel-placeholder">
            <div className="panel-placeholder-title">No DOM available</div>
          </div>
        )}
      </div>

      <div className="elements-styles">
        <div className="elements-styles-header">Styles</div>
        {selectedNodeId === null ? (
          <div style={{ color: 'var(--color-fg-tertiary)', fontSize: 'var(--font-size-xs)' }}>
            Select an element to view styles
          </div>
        ) : styles.length === 0 ? (
          <div style={{ color: 'var(--color-fg-tertiary)', fontSize: 'var(--font-size-xs)' }}>
            No matched styles
          </div>
        ) : (
          styles.map((rule, i) => (
            <div key={i} className="elements-style-rule">
              <div className="elements-style-selector">{rule.selector} {'{'}</div>
              {rule.properties.map((prop, j) => (
                <div key={j} className="elements-style-prop">
                  <span className="elements-style-prop-name">{prop.name}</span>
                  {': '}
                  <span className="elements-style-prop-value">{prop.value}</span>
                  {';'}
                </div>
              ))}
              <div className="elements-style-selector">{'}'}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
