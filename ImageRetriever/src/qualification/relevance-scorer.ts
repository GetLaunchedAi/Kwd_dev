import * as stringSimilarity from 'string-similarity';
import { ImageCandidate } from '../types/candidate.js';
import axios from 'axios';
import { config } from '../config.js';

export class RelevanceScorer {
  /**
   * Scores the relevance of a candidate image based on its text description.
   * Returns a score between 0 and 100.
   */
  textScore(candidate: ImageCandidate, relatedText: string): number {
    if (!relatedText || !candidate.description) {
      return 0;
    }

    const similarity = stringSimilarity.compareTwoStrings(
      relatedText.toLowerCase(),
      candidate.description.toLowerCase()
    );

    // Normalize to 0-100
    return Math.round(similarity * 100);
  }

  /**
   * Scores the relevance of a candidate image using AI Vision.
   * Returns a score between 0 and 100 and a blurriness flag.
   */
  async visualScore(candidate: ImageCandidate, relatedText: string): Promise<{ score: number; isBlurry: boolean }> {
    if (!config.openrouterApiKey) {
      console.warn('OpenRouter API key is missing. Skipping visual scoring.');
      return { score: 0, isBlurry: false };
    }

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'nvidia/nemotron-nano-12b-v2-vl:free',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are an expert image relevance and quality grader. Your task is to score how well an image matches the provided context and detect if it is blurry.

Context: "${relatedText}"

Evaluation Criteria:
1. Subject Accuracy: Does the image contain the specific subjects, objects, or people described in the context?
2. Contextual Fit: Does the setting, background, and environment match the context?
3. Composition & Focus: Is the main subject clearly visible and well-composed?
4. Mood & Tone: Does the visual style (lighting, colors, atmosphere) align with the intended context?
5. Blurriness Detection: Is the image blurry, out of focus, or low resolution?

Grading Scale for relevance:
- 90-100: Exceptional. Meets all criteria perfectly. 
- 70-89: High Relevance. Strong match across most criteria; minor stylistic or background differences.
- 50-69: Moderate Relevance. Subject is correct, but composition or mood is generic or slightly off.
- 30-49: Low Relevance. Tangential connection only; lacks primary subjects or fit.
- 0-29: Irrelevant. No meaningful connection to the context.

Respond ONLY with a JSON object in the following format:
{"relevance": 85, "isBlurry": false}

Do not include any other text, reasoning, or markdown formatting.`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: candidate.url
                  }
                }
              ]
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${config.openrouterApiKey}`,
            'HTTP-Referer': 'https://github.com/ImageRetriever', // Required by OpenRouter
            'X-Title': 'ImageRetriever',
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0]?.message?.content?.trim();
      
      try {
        // Handle cases where the model might wrap response in backticks
        const jsonStr = content.replace(/^```json/, '').replace(/```$/, '').trim();
        const result = JSON.parse(jsonStr);
        
        const score = Math.min(100, Math.max(0, parseInt(result.relevance, 10) || 0));
        const isBlurry = !!result.isBlurry;

        return { score, isBlurry };
      } catch (parseError) {
        console.warn('AI Vision returned invalid JSON:', content);
        // Fallback: try to find a number in the output if JSON parsing fails
        const matches = content.match(/\d+/);
        const score = matches ? Math.min(100, Math.max(0, parseInt(matches[0], 10))) : 0;
        return { score, isBlurry: false };
      }
    } catch (error) {
      console.error('Error during AI Vision scoring:', error instanceof Error ? error.message : error);
      return { score: 0, isBlurry: false };
    }
  }
}

