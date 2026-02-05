import React from 'react';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';
import type { ThemeColor } from '../../shared/types';

// Color definitions with Tailwind classes
const COLORS: { name: ThemeColor; bg: string; ring: string }[] = [
    { name: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-500' },
    { name: 'purple', bg: 'bg-purple-500', ring: 'ring-purple-500' },
    { name: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
    { name: 'red', bg: 'bg-red-500', ring: 'ring-red-500' },
    { name: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
    { name: 'yellow', bg: 'bg-yellow-500', ring: 'ring-yellow-500' },
    { name: 'green', bg: 'bg-green-500', ring: 'ring-green-500' },
    { name: 'teal', bg: 'bg-teal-500', ring: 'ring-teal-500' },
    { name: 'cyan', bg: 'bg-cyan-500', ring: 'ring-cyan-500' },
    { name: 'gray', bg: 'bg-gray-500', ring: 'ring-gray-500' },
];

interface ColorPickerProps {
    selected: ThemeColor;
    onSelect: (color: ThemeColor) => void;
    className?: string;
}

export function ColorPicker({ selected, onSelect, className }: ColorPickerProps) {
    return (
        <div className={cn("flex flex-wrap gap-2", className)}>
            {COLORS.map(({ name, bg, ring }) => (
                <button
                    key={name}
                    type="button"
                    onClick={() => onSelect(name)}
                    className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center",
                        "transition-all duration-150",
                        bg,
                        selected === name && "ring-2 ring-offset-2",
                        selected === name && ring
                    )}
                >
                    {selected === name && (
                        <Check className="h-4 w-4 text-white" />
                    )}
                </button>
            ))}
        </div>
    );
}

// Helper to get color classes by name
export function getColorClasses(name: ThemeColor): { bg: string; ring: string } {
    const found = COLORS.find(c => c.name === name);
    return found || { bg: 'bg-gray-500', ring: 'ring-gray-500' };
}
