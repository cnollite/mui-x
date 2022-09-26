import {
  GRID_ROOT_GROUP_ID,
  GridGroupNode,
  GridLeafNode,
  GridRowId,
  GridRowTreeConfig,
} from '@mui/x-data-grid';
import { GridTreeDepths, GridRowTreeUpdatedGroupsManager } from '@mui/x-data-grid/internals';
import {
  addGroupDefaultExpansion,
  getGroupRowIdFromPath,
  insertNodeInTree,
  updateGroupNodeIdAndAutoGenerated,
} from './utils';
import { GridTreePathDuplicateHandler, RowTreeBuilderGroupingCriterion } from './models';
import { DataGridProProps } from '../../models/dataGridProProps';

interface InsertDataRowInTreeParams {
  /**
   * ID of the data row to insert in the tree.
   */
  id: GridRowId;
  /**
   * Path of the data row to insert in the tree.
   */
  path: RowTreeBuilderGroupingCriterion[];
  /**
   * Tree in which to insert the data row.
   * This tree can be mutated but it's children should not.
   * For instance:
   *
   * - `tree[nodeId] = newNode` => valid
   * - `tree[nodeId].children.push(newNodeId)` => invalid
   */
  tree: GridRowTreeConfig;
  /**
   * Amount of nodes at each depth of the tree.
   * This object can be mutated.
   * For instance:
   *
   * - `treeDepths[nodeDepth] = treeDepth[nodeDepth] + 1` => valid
   */
  treeDepths: GridTreeDepths;
  /**
   * Object tracking the action performed on each group.
   * Used to decide which groups to refresh on sorting, filtering, aggregation, ...
   * If not defined, then the tracking will be skipped.
   */
  updatedGroupsManager?: GridRowTreeUpdatedGroupsManager;
  /**
   * Callback fired when trying to insert a data row for a path already populated by another data row.
   */
  onDuplicatePath?: GridTreePathDuplicateHandler;
  isGroupExpandedByDefault?: DataGridProProps['isGroupExpandedByDefault'];
  defaultGroupingExpansionDepth: number;
}

/**
 * Inserts a data row in a tree.
 * For each steps of its path:
 * - if a node exists with the same partial path, it will register this node as the ancestor of the data row.
 * - if not, it will create an auto-generated node and register it as ancestor of the data row.
 */
export const insertDataRowInTree = ({
  id,
  path,
  updatedGroupsManager,
  tree,
  treeDepths,
  onDuplicatePath,
  isGroupExpandedByDefault,
  defaultGroupingExpansionDepth,
}: InsertDataRowInTreeParams) => {
  let parentNodeId = GRID_ROOT_GROUP_ID;

  for (let depth = 0; depth < path.length; depth += 1) {
    const { key, field } = path[depth];
    const fieldWithDefaultValue = field ?? '__no_field__';
    const keyWithDefaultValue = key ?? '__no_key__';
    const existingNodeIdWithPartialPath = (tree[parentNodeId] as GridGroupNode).childrenFromPath?.[
      fieldWithDefaultValue
    ]?.[keyWithDefaultValue.toString()];

    // When we reach the last step of the path,
    // We need to create a node for the row passed to `insertNodeInTree`
    if (depth === path.length - 1) {
      // If no node matches the full path,
      // We create a leaf node for the data row.
      if (existingNodeIdWithPartialPath == null) {
        const leafNode: GridLeafNode = {
          type: 'leaf',
          id,
          depth,
          parent: parentNodeId,
          groupingKey: key,
        };

        updatedGroupsManager?.addAction(parentNodeId, 'insertChildren');

        insertNodeInTree({
          node: leafNode,
          tree,
          treeDepths,
        });
      } else {
        const existingNodeWithPartialPath = tree[existingNodeIdWithPartialPath];

        // If we already have an auto-generated group matching the partial path,
        // We replace it with the node from of data row passed to `insertNodeInTree`
        if (
          existingNodeWithPartialPath.type === 'group' &&
          existingNodeWithPartialPath.isAutoGenerated
        ) {
          updatedGroupsManager?.addAction(parentNodeId, 'removeChildren');
          updatedGroupsManager?.addAction(parentNodeId, 'insertChildren');

          updateGroupNodeIdAndAutoGenerated({
            tree,
            treeDepths,
            node: existingNodeWithPartialPath,
            updatedNode: {
              id,
              isAutoGenerated: false,
            },
          });
        } else {
          // If we have another row matching the partial path, then there is a duplicate in the dataset.
          // We warn the user and skip the current row.
          onDuplicatePath?.(existingNodeIdWithPartialPath, id, path);
        }
      }
    }
    // For the intermediary steps of the path,
    // We need to make sure that there is a node matching the partial path.
    //
    // If no node matches the partial path,
    // We create an auto-generated group node.
    else if (existingNodeIdWithPartialPath == null) {
      const nodeId = getGroupRowIdFromPath(path.slice(0, depth + 1));

      const autoGeneratedGroupNode: GridGroupNode = {
        type: 'group',
        id: nodeId,
        parent: parentNodeId,
        depth,
        isAutoGenerated: true,
        groupingKey: key,
        groupingField: field,
        children: [],
        childrenFromPath: {},
      };

      updatedGroupsManager?.addAction(parentNodeId, 'insertChildren');

      insertNodeInTree({
        node: addGroupDefaultExpansion({
          node: autoGeneratedGroupNode,
          defaultGroupingExpansionDepth,
          isGroupExpandedByDefault,
        }),
        tree,
        treeDepths,
      });

      parentNodeId = nodeId;
    }
    // For the intermediary steps of the path
    // If a node matches the partial path, we use it as parent for the next step
    else {
      const currentGroupNode = tree[existingNodeIdWithPartialPath];

      // If the node matching the partial path is not a group, we turn it into a group
      if (currentGroupNode.type !== 'group') {
        const groupNode: GridGroupNode = {
          type: 'group',
          id: currentGroupNode.id,
          parent: currentGroupNode.parent,
          depth: currentGroupNode.depth,
          isAutoGenerated: false,
          groupingKey: key,
          groupingField: field,
          children: [],
          childrenFromPath: {},
        };
        tree[existingNodeIdWithPartialPath] = addGroupDefaultExpansion({
          node: groupNode,
          defaultGroupingExpansionDepth,
          isGroupExpandedByDefault,
        });
      }
      parentNodeId = currentGroupNode.id;
    }
  }
};
