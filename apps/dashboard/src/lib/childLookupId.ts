// 조회 문자 경계와 저장 record의 정체성 검사는 별개입니다. 월 형식은 해석하지 않습니다.
export const SAFE_CHILD_LOOKUP_PATTERN = "[A-Za-z0-9\\-][A-Za-z0-9_.\\-]{0,255}";
const exact = new RegExp(`^(?:${SAFE_CHILD_LOOKUP_PATTERN})(?![\\s\\S])`);
export const isSafeChildLookupId = (value: unknown): value is string => typeof value === "string" && exact.test(value);
