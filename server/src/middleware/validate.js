import { validationError } from '../lib/errors.js';

/**
 * Validate req.body / req.query / req.params against zod schemas.
 * The parsed (and coerced) values replace the raw ones, so handlers only ever see
 * clean, typed input.
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const issues = [];
    for (const [key, schema] of Object.entries({ body, query, params })) {
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (result.success) {
        // req.query is a getter in some Express versions; store parsed copy separately too.
        req.valid = { ...(req.valid ?? {}), [key]: result.data };
      } else {
        for (const issue of result.error.issues) {
          issues.push({ in: key, path: issue.path.join('.'), message: issue.message });
        }
      }
    }
    if (issues.length) return next(validationError(issues));
    return next();
  };
}
