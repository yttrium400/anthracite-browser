import React from 'react';
import { cn } from '../lib/utils';
import {
    Globe,
    Home,
    Briefcase,
    Code,
    Gamepad2,
    Music,
    Film,
    BookOpen,
    ShoppingCart,
    Heart,
    Star,
    Zap,
    Coffee,
    Sun,
    Moon,
    Cloud,
    Folder,
    Layers,
    Grid,
    Hash,
    AtSign,
    MessageCircle,
    Mail,
    Calendar,
    Clock,
    Camera,
    Image,
    Video,
    Headphones,
    Mic,
    Compass,
    Map,
    Flag,
    Award,
    Target,
    TrendingUp,
    BarChart,
    PieChart,
    Database,
    Server,
    Terminal,
    Github,
    Twitter,
    Youtube,
    Twitch,
    Linkedin,
    Slack,
    Figma,
    Chrome,
} from 'lucide-react';
import type { IconName } from '../../shared/types';

// Icon mapping
const ICONS: { name: IconName; icon: React.FC<{ className?: string }> }[] = [
    { name: 'globe', icon: Globe },
    { name: 'home', icon: Home },
    { name: 'briefcase', icon: Briefcase },
    { name: 'code', icon: Code },
    { name: 'gamepad-2', icon: Gamepad2 },
    { name: 'music', icon: Music },
    { name: 'film', icon: Film },
    { name: 'book-open', icon: BookOpen },
    { name: 'shopping-cart', icon: ShoppingCart },
    { name: 'heart', icon: Heart },
    { name: 'star', icon: Star },
    { name: 'zap', icon: Zap },
    { name: 'coffee', icon: Coffee },
    { name: 'sun', icon: Sun },
    { name: 'moon', icon: Moon },
    { name: 'cloud', icon: Cloud },
    { name: 'folder', icon: Folder },
    { name: 'layers', icon: Layers },
    { name: 'grid', icon: Grid },
    { name: 'hash', icon: Hash },
    { name: 'at-sign', icon: AtSign },
    { name: 'message-circle', icon: MessageCircle },
    { name: 'mail', icon: Mail },
    { name: 'calendar', icon: Calendar },
    { name: 'clock', icon: Clock },
    { name: 'camera', icon: Camera },
    { name: 'image', icon: Image },
    { name: 'video', icon: Video },
    { name: 'headphones', icon: Headphones },
    { name: 'mic', icon: Mic },
    { name: 'compass', icon: Compass },
    { name: 'map', icon: Map },
    { name: 'flag', icon: Flag },
    { name: 'award', icon: Award },
    { name: 'target', icon: Target },
    { name: 'trending-up', icon: TrendingUp },
    { name: 'bar-chart', icon: BarChart },
    { name: 'pie-chart', icon: PieChart },
    { name: 'database', icon: Database },
    { name: 'server', icon: Server },
    { name: 'terminal', icon: Terminal },
    { name: 'github', icon: Github },
    { name: 'twitter', icon: Twitter },
    { name: 'youtube', icon: Youtube },
    { name: 'twitch', icon: Twitch },
    { name: 'linkedin', icon: Linkedin },
    { name: 'slack', icon: Slack },
    { name: 'figma', icon: Figma },
    { name: 'chrome', icon: Chrome },
];

interface IconPickerProps {
    selected: IconName;
    onSelect: (icon: IconName) => void;
    className?: string;
}

export function IconPicker({ selected, onSelect, className }: IconPickerProps) {
    return (
        <div className={cn("grid grid-cols-8 gap-1", className)}>
            {ICONS.map(({ name, icon: Icon }) => (
                <button
                    key={name}
                    type="button"
                    onClick={() => onSelect(name)}
                    className={cn(
                        "h-9 w-9 rounded-lg flex items-center justify-center",
                        "transition-all duration-150",
                        selected === name
                            ? "bg-brand text-white shadow-md"
                            : "bg-surface-tertiary text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                    )}
                >
                    <Icon className="h-4 w-4" />
                </button>
            ))}
        </div>
    );
}

// Helper to get icon component by name
export function getIconComponent(name: IconName): React.FC<{ className?: string }> {
    const found = ICONS.find(i => i.name === name);
    return found?.icon || Globe;
}
