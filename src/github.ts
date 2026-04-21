import * as github from "@actions/github";
import type { PullRequestContext, ReviewThread } from "./types.js";

const THREADS_QUERY = /* GraphQL */ `
  query ($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            comments(first: 20) {
              nodes {
                id
                databaseId
                author { login }
                body
                path
                line
                originalLine
                originalCommit { oid }
                createdAt
                url
              }
            }
          }
        }
      }
    }
  }
`;

const RESOLVE_MUTATION = /* GraphQL */ `
  mutation ($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`;

export function createGitHubClient(token: string) {
  const octokit = github.getOctokit(token);

  return {
    async fetchReviewThreads(pr: PullRequestContext): Promise<ReviewThread[]> {
      const all: ReviewThread[] = [];
      let cursor: string | null = null;
      do {
        // biome-ignore lint/suspicious/noExplicitAny: GraphQL response shape not typed
        const res: any = await octokit.graphql(THREADS_QUERY, {
          owner: pr.owner,
          repo: pr.repo,
          pr: pr.number,
          cursor,
        });
        const conn = res.repository.pullRequest.reviewThreads;
        for (const node of conn.nodes) {
          all.push({
            id: node.id,
            isResolved: node.isResolved,
            isOutdated: node.isOutdated,
            comments: node.comments.nodes,
          });
        }
        cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      } while (cursor);
      return all;
    },

    async resolveReviewThread(threadId: string): Promise<void> {
      await octokit.graphql(RESOLVE_MUTATION, { threadId });
    },
  };
}
