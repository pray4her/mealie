export interface ContentPort { checkText(text: string): Promise<'allowed' | 'rejected'> }
