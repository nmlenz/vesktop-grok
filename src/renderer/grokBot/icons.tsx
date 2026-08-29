/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IconProps } from "@vencord/types/utils/types";

export function GrokIcon({ height = 24, width = 24, className, ...props }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" height={height} width={width} className={className} aria-hidden="true" {...props}>
            <path
                fill="currentColor"
                d="M12 2.2 13.7 8.3 20 10l-6.3 1.7L12 17.8l-1.7-6.1L4 10l6.3-1.7L12 2.2Zm7.4 11.2 1 3.3 3.4.9-3.4.9-1 3.3-.9-3.3-3.4-.9 3.4-.9.9-3.3Zm-14.8 0 .9 3.3 3.4.9-3.4.9-.9 3.3-1-3.3-3.3-.9 3.3-.9 1-3.3Z"
            />
        </svg>
    );
}
