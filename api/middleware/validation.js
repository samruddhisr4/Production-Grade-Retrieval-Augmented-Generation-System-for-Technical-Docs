const Joi = require("joi");

// Validation schemas
const schemas = {
  query: Joi.object({
    query: Joi.string().min(3).max(1000).required().messages({
      "string.min": "Query must be at least 3 characters long",
      "string.max": "Query must be less than 1000 characters",
      "any.required": "Query is required",
    }),
    userId: Joi.string().allow(null).optional(),
    topK: Joi.number().integer().min(1).max(20).default(5),
    stream: Joi.boolean().default(false),
    useCache: Joi.boolean().default(true),
  }),

  documentIngestion: Joi.object({
    content: Joi.string()
      .min(10)
      .max(100000) // 100KB limit
      .required()
      .messages({
        "string.min": "Document content must be at least 10 characters",
        "string.max": "Document content exceeds maximum size",
        "any.required": "Document content is required",
      }),
    metadata: Joi.object({
      title: Joi.string().max(255).required(),
      source: Joi.string().max(255).optional(),
      author: Joi.string().max(255).optional(),
      tags: Joi.array().items(Joi.string()).optional(),
      document_id: Joi.string().optional(),
    }).required(),
    stream: Joi.boolean().default(false),
  }),
};

/**
 * Generic validation middleware
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Return all errors
      stripUnknown: true, // Remove unknown fields
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      }));

      return res.status(400).json({
        error: "Validation failed",
        details: errors,
      });
    }

    // Update request body with validated/cleaned data
    req.body = value;
    next();
  };
};

module.exports = {
  validateQuery: validate(schemas.query),
  validateDocumentIngestion: validate(schemas.documentIngestion),
  schemas,
};
