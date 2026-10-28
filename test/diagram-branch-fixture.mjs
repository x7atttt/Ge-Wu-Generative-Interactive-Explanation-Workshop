export const branchDiagram = {
  type: "diagram", title: "快速排序的分区与递归流程", direction: "LR",
  caption: "固定流程示意：先完成单轮分区，再分别处理左右子数组。",
  groups: [{ id: "partition", label: "单轮分区" }, { id: "recursion", label: "递归治理" }],
  nodes: [
    { id: "pivot", label: "选取基准", group: "partition", description: "选取基准，记录坑位。" },
    { id: "scan", label: "双向扫描分区", group: "partition", description: "移动左右指针，直到相遇。" },
    { id: "place", label: "基准归位", group: "partition", description: "基准两侧形成子数组。" },
    { id: "left", label: "左子数组递归", group: "recursion", description: "递归处理小于基准的部分。" },
    { id: "right", label: "右子数组递归", group: "recursion", description: "递归处理大于基准的部分。" },
    { id: "stop", label: "子数组长度 ≤ 1", group: "recursion", description: "无需再分区。" },
  ],
  edges: [
    { id: "choose_scan", source: "pivot", target: "scan", label: "确定 pivot 与坑位" },
    { id: "scan_place", source: "scan", target: "place", label: "指针相遇" },
    { id: "split_left", source: "place", target: "left", label: "小于基准的部分" },
    { id: "split_right", source: "place", target: "right", label: "大于基准的部分" },
    { id: "left_end", source: "left", target: "stop", label: "规模缩小" },
    { id: "right_end", source: "right", target: "stop", label: "规模缩小" },
  ],
  steps: [
    { title: "单轮分区", description: "先确定基准，再扫描并归位。", nodeIds: ["pivot", "scan", "place"], edgeIds: ["choose_scan", "scan_place"] },
    { title: "左右递归", description: "两个子数组分别递归处理。", nodeIds: ["place", "left", "right"], edgeIds: ["split_left", "split_right"] },
    { title: "递归终点", description: "子数组长度不超过 1 时终止。", nodeIds: ["left", "right", "stop"], edgeIds: ["left_end", "right_end"] },
  ],
};
