import React from 'react';
import { sortHeaderStyle, sortIcon } from '@/utils';

export interface Column {
  field: string;
  label: string;
  sortable?: boolean; // defaults to true
}

export interface SortableTableHeaderProps {
  columns: Column[];
  activeField: string;
  direction: 'asc' | 'desc';
  onSort: (field: string) => void;
  borderColor: string; // for active highlight
}

const SortableTableHeader: React.FC<SortableTableHeaderProps> = ({
  columns,
  activeField,
  direction,
  onSort,
  borderColor,
}) => (
  <thead>
    <tr>
      {columns.map((col) => {
        const isSortable = col.sortable !== false;
        return (
          <th
            key={col.field}
            style={{
              ...sortHeaderStyle(activeField, col.field, borderColor),
              ...(isSortable ? {} : { cursor: 'default' }),
            }}
            onClick={isSortable ? () => onSort(col.field) : undefined}
          >
            {col.label}
            {isSortable ? sortIcon(activeField, direction, col.field) : ''}
          </th>
        );
      })}
    </tr>
  </thead>
);

export default React.memo(SortableTableHeader);
