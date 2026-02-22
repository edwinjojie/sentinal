import { GuardConfig } from './types';
export declare function checkLimits(subjectId: string, model: string, config: GuardConfig): Promise<{
    allowed: boolean;
    reason: string;
} | {
    allowed: true;
    reason?: undefined;
}>;
