import React from 'react';
import { cn } from '../lib/utils';
import {
    Globe,
    House,
    Briefcase,
    Code,
    GameController,
    MusicNote,
    FilmSlate,
    BookOpen,
    ShoppingCart,
    Heart,
    Star,
    Lightning,
    Coffee,
    Sun,
    Moon,
    Cloud,
    Folder,
    Stack,
    GridFour,
    Hash,
    At,
    Chat,
    Envelope,
    Calendar,
    Clock,
    Camera,
    Image,
    Video,
    Headphones,
    Microphone,
    Compass,
    MapPin,
    Flag,
    Medal,
    Target,
    TrendUp,
    ChartBar,
    ChartPie,
    Database,
    HardDrives,
    Terminal,
    GithubLogo,
    TwitterLogo,
    YoutubeLogo,
    TwitchLogo,
    LinkedinLogo,
    SlackLogo,
    FigmaLogo,
} from '@phosphor-icons/react';
import type { IconName } from '../../shared/types';

// Icon mapping
const ICONS: { name: IconName; icon: React.FC<{ className?: string }> }[] = [
    { name: 'globe', icon: Globe },
    { name: 'home', icon: House },
    { name: 'briefcase', icon: Briefcase },
    { name: 'code', icon: Code },
    { name: 'gamepad-2', icon: GameController },
    { name: 'music', icon: MusicNote },
    { name: 'film', icon: FilmSlate },
    { name: 'book-open', icon: BookOpen },
    { name: 'shopping-cart', icon: ShoppingCart },
    { name: 'heart', icon: Heart },
    { name: 'star', icon: Star },
    { name: 'zap', icon: Lightning },
    { name: 'coffee', icon: Coffee },
    { name: 'sun', icon: Sun },
    { name: 'moon', icon: Moon },
    { name: 'cloud', icon: Cloud },
    { name: 'folder', icon: Folder },
    { name: 'layers', icon: Stack },
    { name: 'grid', icon: GridFour },
    { name: 'hash', icon: Hash },
    { name: 'at-sign', icon: At },
    { name: 'message-circle', icon: Chat },
    { name: 'mail', icon: Envelope },
    { name: 'calendar', icon: Calendar },
    { name: 'clock', icon: Clock },
    { name: 'camera', icon: Camera },
    { name: 'image', icon: Image },
    { name: 'video', icon: Video },
    { name: 'headphones', icon: Headphones },
    { name: 'mic', icon: Microphone },
    { name: 'compass', icon: Compass },
    { name: 'map', icon: MapPin },
    { name: 'flag', icon: Flag },
    { name: 'award', icon: Medal },
    { name: 'target', icon: Target },
    { name: 'trending-up', icon: TrendUp },
    { name: 'bar-chart', icon: ChartBar },
    { name: 'pie-chart', icon: ChartPie },
    { name: 'database', icon: Database },
    { name: 'server', icon: HardDrives },
    { name: 'terminal', icon: Terminal },
    { name: 'github', icon: GithubLogo },
    { name: 'twitter', icon: TwitterLogo },
    { name: 'youtube', icon: YoutubeLogo },
    { name: 'twitch', icon: TwitchLogo },
    { name: 'linkedin', icon: LinkedinLogo },
    { name: 'slack', icon: SlackLogo },
    { name: 'figma', icon: FigmaLogo },
    { name: 'chrome', icon: Globe },
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
                            ? "bg-brand text-white shadow-md shadow-brand/20"
                            : "bg-white/[0.06] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary"
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
