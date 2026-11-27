import type { QueryClient } from '@tanstack/react-query';
import { createUseMutation, createUseQuery } from '../http';
import newsletterService from '../services/newsletterService.ts';
import type {
  AddPortalUsersRequest,
  AddSubscribersRequest,
  AddSubscribersResponse,
  ConfirmSubscriptionResponse,
  CreateMailingListRequest,
  CreateNewsletterRequest,
  ListMailingListSubscribersQuery,
  ListMailingListsQuery,
  ListNewsletterDeliveriesQuery,
  ListNewslettersQuery,
  ListSubscriberResponse,
  ListSubscribersQuery,
  MailingListResponse,
  NewsletterAudienceResponse,
  NewsletterDeliveryResponse,
  NewsletterDetailResponse,
  NewsletterImageResponse,
  NewsletterPreviewResponse,
  NewsletterSettingsResponse,
  NewsletterSummaryResponse,
  PaginatedData,
  PreferencesLinkResponse,
  PreviewNewsletterRequest,
  PublicMailingListResponse,
  PublicSubscribeRequest,
  PublicSubscribeResponse,
  PublicUpdatePreferencesRequest,
  SendNewsletterRequest,
  SendTestRequest,
  SendTestResponse,
  SubscriberPreferencesResponse,
  SubscriberResponse,
  UnsubscribeRequest,
  UnsubscribeResponse,
  UpdateMailingListRequest,
  UpdateNewsletterRequest,
  UpdateSubscriberRequest,
} from '@nonce/shared';

// Every key starts with 'newsletter', then the audience (public / admin),
// so one prefix invalidates a whole area.
export const newsletterKeys = {
  all: ['newsletter'] as const,
  publicLists: () => ['newsletter', 'public', 'lists'] as const,
  publicPreferences: (token: string) =>
    ['newsletter', 'public', 'preferences', token] as const,
  lists: () => ['newsletter', 'admin', 'lists'] as const,
  listIndex: (query: ListMailingListsQuery) =>
    ['newsletter', 'admin', 'lists', 'index', query] as const,
  list: (id: string) => ['newsletter', 'admin', 'lists', 'one', id] as const,
  listSubscribers: (id: string, query?: ListMailingListSubscribersQuery) =>
    query
      ? (['newsletter', 'admin', 'lists', 'subscribers', id, query] as const)
      : (['newsletter', 'admin', 'lists', 'subscribers', id] as const),
  subscribers: () => ['newsletter', 'admin', 'subscribers'] as const,
  subscriberIndex: (query: ListSubscribersQuery) =>
    ['newsletter', 'admin', 'subscribers', query] as const,
  newsletters: () => ['newsletter', 'admin', 'newsletters'] as const,
  newsletterIndex: (query: ListNewslettersQuery) =>
    ['newsletter', 'admin', 'newsletters', 'index', query] as const,
  newsletter: (id: string) =>
    ['newsletter', 'admin', 'newsletters', 'one', id] as const,
  audience: (id: string) =>
    ['newsletter', 'admin', 'newsletters', 'audience', id] as const,
  deliveries: (id: string, query?: ListNewsletterDeliveriesQuery) =>
    query
      ? ([
          'newsletter',
          'admin',
          'newsletters',
          'deliveries',
          id,
          query,
        ] as const)
      : (['newsletter', 'admin', 'newsletters', 'deliveries', id] as const),
  settings: () => ['newsletter', 'admin', 'settings'] as const,
};

// =========================
// Public — Queries
// =========================

export const usePublicMailingLists = createUseQuery<
  PublicMailingListResponse[],
  void
>(
  () => newsletterKeys.publicLists(),
  () => () => newsletterService.listPublicLists()
);

export const usePreferencesByToken = createUseQuery<
  SubscriberPreferencesResponse,
  string
>(
  token => newsletterKeys.publicPreferences(token),
  token => () => newsletterService.getPreferencesByToken(token)
);

// =========================
// Public — Mutations
// =========================

export const useSubscribe = createUseMutation<
  PublicSubscribeResponse,
  PublicSubscribeRequest
>(body => newsletterService.subscribe(body));

// A mutation, not a query: it changes state and must not refire on focus.
export const useConfirmSubscription = createUseMutation<
  ConfirmSubscriptionResponse,
  { token: string }
>(({ token }) => newsletterService.confirmSubscription(token));

export const useUpdatePreferencesByToken = createUseMutation<
  SubscriberPreferencesResponse,
  PublicUpdatePreferencesRequest
>(body => newsletterService.updatePreferencesByToken(body), {
  queryInvalidation: async ({ queryClient, variables, data }) => {
    queryClient.setQueryData(
      newsletterKeys.publicPreferences(variables.token),
      data
    );
  },
});

export const useUnsubscribe = createUseMutation<
  UnsubscribeResponse,
  UnsubscribeRequest
>(body => newsletterService.unsubscribe(body), {
  queryInvalidation: async ({ queryClient, variables }) => {
    await queryClient.invalidateQueries({
      queryKey: newsletterKeys.publicPreferences(variables.token),
    });
  },
});

// =========================
// Signed-in user
// =========================

// Always resolves to the same message; the link itself arrives by email.
export const useRequestPreferencesLink = createUseMutation<
  PreferencesLinkResponse,
  void
>(() => newsletterService.requestPreferencesLink());

// =========================
// Admin: mailing lists — Queries
// =========================

export const useMailingLists = createUseQuery<
  MailingListResponse[],
  ListMailingListsQuery
>(
  query => newsletterKeys.listIndex(query),
  query => () => newsletterService.listMailingLists(query)
);

export const useMailingList = createUseQuery<MailingListResponse, string>(
  id => newsletterKeys.list(id),
  id => () => newsletterService.getMailingList(id)
);

export const useMailingListSubscribers = createUseQuery<
  PaginatedData<ListSubscriberResponse>,
  { listId: string; query: ListMailingListSubscribersQuery }
>(
  ({ listId, query }) => newsletterKeys.listSubscribers(listId, query),
  ({ listId, query }) =>
    () =>
      newsletterService.listMailingListSubscribers(listId, query)
);

// =========================
// Admin: mailing lists — Mutations
// =========================

// List changes show up in counts, in subscriber rows and in the list names on
// newsletters, so these invalidate every admin newsletter query.
const invalidateAdmin = async ({
  queryClient,
}: {
  queryClient: QueryClient;
}) => {
  await queryClient.invalidateQueries({
    queryKey: ['newsletter', 'admin'],
  });
};

export const useCreateMailingList = createUseMutation<
  MailingListResponse,
  CreateMailingListRequest
>(body => newsletterService.createMailingList(body), {
  queryInvalidation: async ({ queryClient }) => {
    await queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() });
  },
});

export const useUpdateMailingList = createUseMutation<
  MailingListResponse,
  { id: string; body: UpdateMailingListRequest }
>(({ id, body }) => newsletterService.updateMailingList(id, body), {
  queryInvalidation: invalidateAdmin,
});

export const useDeleteMailingList = createUseMutation<void, { id: string }>(
  ({ id }) => newsletterService.deleteMailingList(id),
  {
    queryInvalidation: async ({ queryClient, variables }) => {
      // Dropped rather than invalidated, so the page still mounted for a tick
      // does not refetch the list it just deleted and 404.
      queryClient.removeQueries({
        queryKey: newsletterKeys.list(variables.id),
      });
      queryClient.removeQueries({
        queryKey: newsletterKeys.listSubscribers(variables.id),
      });
      await invalidateAdmin({ queryClient });
    },
  }
);

export const useAddMailingListSubscribers = createUseMutation<
  AddSubscribersResponse,
  { listId: string; body: AddSubscribersRequest }
>(
  ({ listId, body }) =>
    newsletterService.addMailingListSubscribers(listId, body),
  {
    queryInvalidation: async ({ queryClient }) => {
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() });
      await queryClient.invalidateQueries({
        queryKey: newsletterKeys.subscribers(),
      });
    },
  }
);

export const useAddPortalUsersToMailingList = createUseMutation<
  AddSubscribersResponse,
  { listId: string; body: AddPortalUsersRequest }
>(
  ({ listId, body }) =>
    newsletterService.addPortalUsersToMailingList(listId, body),
  {
    queryInvalidation: async ({ queryClient, variables }) => {
      // A dry run only counts; nothing changed.
      if (variables.body.dryRun) return;
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() });
      await queryClient.invalidateQueries({
        queryKey: newsletterKeys.subscribers(),
      });
    },
  }
);

export const useRemoveMailingListSubscription = createUseMutation<
  void,
  { listId: string; subscriptionId: string }
>(
  ({ listId, subscriptionId }) =>
    newsletterService.removeMailingListSubscription(listId, subscriptionId),
  {
    queryInvalidation: async ({ queryClient }) => {
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() });
      await queryClient.invalidateQueries({
        queryKey: newsletterKeys.subscribers(),
      });
    },
  }
);

export const useExportMailingListSubscribers = createUseMutation<
  Blob,
  { listId: string }
>(({ listId }) => newsletterService.exportMailingListSubscribers(listId));

// =========================
// Admin: subscribers
// =========================

export const useSubscribers = createUseQuery<
  PaginatedData<SubscriberResponse>,
  ListSubscribersQuery
>(
  query => newsletterKeys.subscriberIndex(query),
  query => () => newsletterService.listSubscribers(query)
);

export const useUpdateSubscriber = createUseMutation<
  SubscriberResponse,
  { id: string; body: UpdateSubscriberRequest }
>(({ id, body }) => newsletterService.updateSubscriber(id, body), {
  queryInvalidation: async ({ queryClient }) => {
    await queryClient.invalidateQueries({
      queryKey: newsletterKeys.subscribers(),
    });
    await queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() });
  },
});

export const useDeleteSubscriber = createUseMutation<void, { id: string }>(
  ({ id }) => newsletterService.deleteSubscriber(id),
  {
    queryInvalidation: async ({ queryClient }) => {
      await queryClient.invalidateQueries({
        queryKey: newsletterKeys.subscribers(),
      });
      await queryClient.invalidateQueries({ queryKey: newsletterKeys.lists() });
    },
  }
);

// =========================
// Admin: newsletters — Queries
// =========================

export const useNewsletters = createUseQuery<
  PaginatedData<NewsletterSummaryResponse>,
  ListNewslettersQuery
>(
  query => newsletterKeys.newsletterIndex(query),
  query => () => newsletterService.listNewsletters(query)
);

export const useNewsletter = createUseQuery<NewsletterDetailResponse, string>(
  id => newsletterKeys.newsletter(id),
  id => () => newsletterService.getNewsletter(id)
);

export const useNewsletterAudience = createUseQuery<
  NewsletterAudienceResponse,
  string
>(
  id => newsletterKeys.audience(id),
  id => () => newsletterService.getNewsletterAudience(id)
);

export const useNewsletterDeliveries = createUseQuery<
  PaginatedData<NewsletterDeliveryResponse>,
  { newsletterId: string; query: ListNewsletterDeliveriesQuery }
>(
  ({ newsletterId, query }) => newsletterKeys.deliveries(newsletterId, query),
  ({ newsletterId, query }) =>
    () =>
      newsletterService.listNewsletterDeliveries(newsletterId, query)
);

export const useNewsletterSettings = createUseQuery<
  NewsletterSettingsResponse,
  void
>(
  () => newsletterKeys.settings(),
  () => () => newsletterService.getNewsletterSettings()
);

// =========================
// Admin: newsletters — Mutations
// =========================

export const useCreateNewsletter = createUseMutation<
  NewsletterDetailResponse,
  CreateNewsletterRequest
>(body => newsletterService.createNewsletter(body), {
  queryInvalidation: async ({ queryClient, data }) => {
    queryClient.setQueryData(newsletterKeys.newsletter(data.id), data);
    await queryClient.invalidateQueries({
      queryKey: [...newsletterKeys.newsletters(), 'index'],
    });
  },
});

// Autosave goes through here, so it writes the response into the cache rather
// than refetching the newsletter the editor is showing.
export const useUpdateNewsletter = createUseMutation<
  NewsletterDetailResponse,
  { id: string; body: UpdateNewsletterRequest }
>(({ id, body }) => newsletterService.updateNewsletter(id, body), {
  queryInvalidation: async ({ queryClient, variables, data }) => {
    queryClient.setQueryData(newsletterKeys.newsletter(variables.id), data);
    await queryClient.invalidateQueries({
      queryKey: [...newsletterKeys.newsletters(), 'index'],
    });
    await queryClient.invalidateQueries({
      queryKey: newsletterKeys.audience(variables.id),
    });
  },
});

export const useDeleteNewsletter = createUseMutation<void, { id: string }>(
  ({ id }) => newsletterService.deleteNewsletter(id),
  {
    queryInvalidation: async ({ queryClient, variables }) => {
      queryClient.removeQueries({
        queryKey: newsletterKeys.newsletter(variables.id),
      });
      queryClient.removeQueries({
        queryKey: newsletterKeys.audience(variables.id),
      });
      await queryClient.invalidateQueries({
        queryKey: [...newsletterKeys.newsletters(), 'index'],
      });
    },
  }
);

export const useDuplicateNewsletter = createUseMutation<
  NewsletterDetailResponse,
  { id: string }
>(({ id }) => newsletterService.duplicateNewsletter(id), {
  queryInvalidation: async ({ queryClient, data }) => {
    queryClient.setQueryData(newsletterKeys.newsletter(data.id), data);
    await queryClient.invalidateQueries({
      queryKey: [...newsletterKeys.newsletters(), 'index'],
    });
  },
});

export const usePreviewNewsletter = createUseMutation<
  NewsletterPreviewResponse,
  { id: string; body?: PreviewNewsletterRequest }
>(({ id, body }) => newsletterService.previewNewsletter(id, body));

export const useSendTestNewsletter = createUseMutation<
  SendTestResponse,
  { id: string; body: SendTestRequest }
>(({ id, body }) => newsletterService.sendTestNewsletter(id, body));

// Send, unschedule, cancel and retry all move the newsletter between states and
// change its deliveries; the settings card's sent-in-24h count moves too.
const invalidateNewsletterState = async ({
  queryClient,
  variables,
  data,
}: {
  queryClient: QueryClient;
  variables: { id: string };
  data: NewsletterDetailResponse;
}) => {
  queryClient.setQueryData(newsletterKeys.newsletter(variables.id), data);
  await queryClient.invalidateQueries({
    queryKey: [...newsletterKeys.newsletters(), 'index'],
  });
  await queryClient.invalidateQueries({
    queryKey: newsletterKeys.deliveries(variables.id),
  });
  await queryClient.invalidateQueries({
    queryKey: newsletterKeys.audience(variables.id),
  });
  await queryClient.invalidateQueries({ queryKey: newsletterKeys.settings() });
};

export const useSendNewsletter = createUseMutation<
  NewsletterDetailResponse,
  { id: string; body?: SendNewsletterRequest }
>(({ id, body }) => newsletterService.sendNewsletter(id, body), {
  queryInvalidation: invalidateNewsletterState,
});

export const useUnscheduleNewsletter = createUseMutation<
  NewsletterDetailResponse,
  { id: string }
>(({ id }) => newsletterService.unscheduleNewsletter(id), {
  queryInvalidation: invalidateNewsletterState,
});

export const useCancelNewsletter = createUseMutation<
  NewsletterDetailResponse,
  { id: string }
>(({ id }) => newsletterService.cancelNewsletter(id), {
  queryInvalidation: invalidateNewsletterState,
});

export const useRetryFailedDeliveries = createUseMutation<
  NewsletterDetailResponse,
  { id: string }
>(({ id }) => newsletterService.retryFailedDeliveries(id), {
  queryInvalidation: invalidateNewsletterState,
});

export const useUploadNewsletterImage = createUseMutation<
  NewsletterImageResponse,
  { file: File }
>(({ file }) => newsletterService.uploadNewsletterImage(file));
