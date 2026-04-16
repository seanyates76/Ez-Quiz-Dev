# Lazy Explanations Feature

This document describes the implementation of Option 0 (Lazy, on-demand explanations) for Ez-Quiz-App.

## Overview

The lazy explanations feature allows users to request explanations for quiz questions after completion, without affecting the existing generation pipeline. This is a stateless, minimal-cost approach that only generates explanations when explicitly requested.

## Files Added

- `netlify/functions/lib/providers.explain.js` - Explanation provider module
- `netlify/functions/explain-answers-lazy.js` - Netlify Function for lazy explanations  

## API Endpoint

### POST `/.netlify/functions/explain-answers-lazy`

Request explanations for specific quiz questions by providing the raw quiz lines and indices.

#### Request Format

```json
{
  "lines": ["MC|...", "TF|...", ...],
  "index": 3            // OR: "indices": [0,2,5]
}
```

#### Response Format

```json
{
  "explanations": {
    "3": { "explanation": "Concise rationale..." },
    "5": { "explanation": "..." }
  }
}
```

#### Error Responses

- `400 Bad Request` - Invalid JSON, missing fields, or indices out of range
- `401 Unauthorized` - Invalid bearer token (if `EXPLAIN_BEARER_TOKEN` is set)
- `405 Method Not Allowed` - Non-POST request
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server-side error
- `504 Gateway Timeout` - Explanation generation timed out

## Supported Question Types

All four existing question types are fully supported:

### Multiple Choice (MC)
- Single answer: `MC|Question?|A) Opt1;B) Opt2;C) Opt3;D) Opt4|A`
- Multiple answers: `MC|Question?|A) Opt1;B) Opt2;C) Opt3;D) Opt4|A,C`

### True/False (TF)
- Format: `TF|Statement.|T` or `TF|Statement.|F`

### Yes/No (YN)  
- Format: `YN|Question?|Y` or `YN|Question?|N`

### Matching (MT)
- Format: `MT|Prompt.|1) L1;2) L2|A) R1;B) R2|1-A,2-B`

## Configuration

### Environment Variables

- `AI_PROVIDER` - Provider to use (default: `echo`)
  - `echo` - Returns stub explanations for testing
  - `gemini` - Future: Gemini AI integration  
  - `openai` - Future: OpenAI integration
- `EXPLAIN_LIMIT` - Rate limit per IP (default: 30 requests)
- `EXPLAIN_WINDOW_MS` - Rate limit window in milliseconds (default: 15 minutes)
- `EXPLAIN_TIMEOUT_MS` - Explanation generation timeout (default: 15 seconds)
- `EXPLAIN_BEARER_TOKEN` - Optional bearer token for authentication
- `ALLOWED_ORIGINS` - Comma-separated list of allowed CORS origins

## Usage Examples

### Single Question Explanation

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/explain-answers-lazy \
  -H "Content-Type: application/json" \
  -d '{
    "lines": [
      "MC|What is the capital of France?|A) London;B) Paris;C) Berlin;D) Madrid|B",
      "TF|The Earth is flat.|F"
    ],
    "index": 0
  }'
```

### Multiple Questions Explanation

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/explain-answers-lazy \
  -H "Content-Type: application/json" \
  -d '{
    "lines": [
      "MC|What is the capital of France?|A) London;B) Paris;C) Berlin;D) Madrid|B",
      "TF|The Earth is flat.|F",
      "YN|Is water H2O?|Y"
    ],
    "indices": [0, 2]
  }'
```

## Echo Provider

The echo provider returns stub explanations for development and testing:

- **MC questions**: Shows correct answer letters
- **TF questions**: Indicates True/False 
- **YN questions**: Indicates Yes/No
- **MT questions**: Notes matching requirement

Example output:
```
"Rationale stub for practice. Correct: B. This is a practice explanation for MC question type."
```

## Future Enhancements

The implementation includes placeholders for:

1. **Real AI Integration**: Gemini and OpenAI providers with actual explanation generation
2. **Caching**: Hash-based caching of explanations to reduce costs
3. **Integrity Verification**: Hash validation of quiz lines to prevent tampering
4. **Enhanced Rate Limiting**: Per-user limits and premium tiers

## Security Considerations

- **Answer Revelation**: Users can request explanations before completing quiz (reveals correct answers). Mitigation should be implemented in the UI layer.
- **Rate Limiting**: Default limits prevent abuse but may need adjustment based on usage patterns.
- **Input Validation**: Quiz lines are parsed and validated but minimal sanitization is performed.

## Testing

The implementation includes comprehensive test coverage:

- Unit tests for all question types
- Edge case handling (invalid input, out of range indices)  
- Integration tests demonstrating full workflow
- API contract validation
- Error handling verification

## No Breaking Changes

This feature is purely additive:
- No existing files were modified
- No changes to existing generation pipeline
- Existing endpoints remain unchanged
- Backward compatibility maintained