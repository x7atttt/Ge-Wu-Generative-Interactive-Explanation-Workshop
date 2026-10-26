import { z } from "zod";

const id = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, "ID 须以字母或下划线开头，仅含字母、数字、下划线和连字符");

export const diagramBlockSchema = z.object({
  type: z.literal("diagram"),
  title: z.string().min(1).max(120),
  caption: z.string().max(500).optional(),
  direction: z.enum(["LR", "TB"]).optional(),
  groups: z.array(z.object({ id, label: z.string().min(1).max(80) })).max(8).optional(),
  nodes: z.array(z.object({
    id,
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(1500),
    group: id.optional(),
  })).min(1).max(40),
  edges: z.array(z.object({
    id, source: id, target: id,
    label: z.string().min(1).max(80).optional(),
    kind: z.enum(["data", "residual"]).optional(),
  })).max(80),
  steps: z.array(z.object({
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(1500),
    nodeIds: z.array(id).min(1).max(40),
    edgeIds: z.array(id).max(80).optional(),
  })).max(20).optional(),
}).superRefine((block, ctx) => {
  const collect = (items: { id: string }[], field: string) => {
    const ids = new Set<string>();
    items.forEach((item, i) => {
      if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: [field, i, "id"], message: `diagram ${field} ID 重复：${item.id}` });
      ids.add(item.id);
    });
    return ids;
  };
  const nodes = collect(block.nodes, "nodes");
  const groups = collect(block.groups ?? [], "groups");
  const edges = collect(block.edges, "edges");
  block.nodes.forEach((node, i) => {
    if (node.group && !groups.has(node.group)) ctx.addIssue({ code: "custom", path: ["nodes", i, "group"], message: `diagram 分组不存在：${node.group}` });
  });
  block.groups?.forEach((group, i) => {
    if (!block.nodes.some(node => node.group === group.id)) ctx.addIssue({ code: "custom", path: ["groups", i], message: `diagram 分组 ${group.id} 没有节点` });
  });
  block.edges.forEach((edge, i) => {
    for (const field of ["source", "target"] as const) {
      if (!nodes.has(edge[field])) ctx.addIssue({ code: "custom", path: ["edges", i, field], message: `diagram 连线引用不存在的节点：${edge[field]}` });
    }
  });
  block.steps?.forEach((step, i) => {
    for (const [field, valid] of [["nodeIds", nodes], ["edgeIds", edges]] as const) {
      step[field]?.forEach((ref, j) => {
        if (!valid.has(ref)) ctx.addIssue({ code: "custom", path: ["steps", i, field, j], message: `diagram 步骤引用不存在：${ref}` });
      });
    }
  });
});

export type DiagramBlock = z.output<typeof diagramBlockSchema>;
