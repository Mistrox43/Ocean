import React, { useCallback, useRef } from 'react';
import { COLORS } from '@/constants';

export interface HoverableRowProps {
  children: React.ReactNode;
  isExpanded?: boolean;
  isSpecial?: boolean; // for unknown sender rows
  specialColor?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const HoverableRow: React.FC<HoverableRowProps> = ({
  children,
  isExpanded = false,
  isSpecial = false,
  specialColor,
  onClick,
  style,
}) => {
  const rowRef = useRef<HTMLTableRowElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (!isExpanded && rowRef.current) {
      rowRef.current.style.background = COLORS.border + '33';
    }
  }, [isExpanded]);

  const handleMouseLeave = useCallback(() => {
    if (rowRef.current) {
      if (isExpanded) {
        rowRef.current.style.background = COLORS.border + '44';
      } else if (isSpecial && specialColor) {
        rowRef.current.style.background = specialColor;
      } else {
        rowRef.current.style.background = 'transparent';
      }
    }
  }, [isExpanded, isSpecial, specialColor]);

  return (
    <tr
      ref={rowRef}
      style={{
        background: isExpanded
          ? COLORS.border + '44'
          : isSpecial && specialColor
            ? specialColor
            : 'transparent',
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </tr>
  );
};

export default React.memo(HoverableRow);
