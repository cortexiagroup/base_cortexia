import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
export const xof = new Intl.NumberFormat('fr-TG', { maximumFractionDigits: 0 })
