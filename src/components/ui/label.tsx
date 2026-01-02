import * as React from 'react';
import clsx from 'clsx';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return <label className={clsx('text-sm font-medium text-gray-700', className)} {...props} />;
}
