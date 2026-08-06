import { z } from "zod";

export const officialMarketCalendarHttpProtocolVersionSchema = z.enum([
  "http_1_0",
  "http_1_1",
  "http_2",
  "http_3"
]);

export type OfficialMarketCalendarHttpProtocolVersion = z.infer<
  typeof officialMarketCalendarHttpProtocolVersionSchema
>;
