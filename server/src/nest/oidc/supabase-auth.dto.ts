import { supabaseExchangeRequestSchema } from '@trek/shared';

import { createZodDto } from 'nestjs-zod';

export class SupabaseExchangeDto extends createZodDto(supabaseExchangeRequestSchema) {}
