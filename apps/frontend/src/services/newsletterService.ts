import axios, {
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { getAuthTokenFromStorage } from './authService.ts';
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

const COMMON_REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * Newsletter endpoints. Split from apiService for the longer timeout: adding a
 * few thousand subscribers, copying portal users into a list, or sending a
 * batch of test emails all run well past the default 10s.
 */
class NewsletterService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      // Repeated keys, never brackets: Express 5 drops `key[]=` params. See
      // the same setting in apiService.
      paramsSerializer: { indexes: null },
    });
  }

  private async request<T>(
    config: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.client.request<T>(config);
  }

  private getRequestHeaders(): AxiosHeaders {
    const headers = new AxiosHeaders(COMMON_REQUEST_HEADERS);
    const authToken = getAuthTokenFromStorage();
    if (authToken) {
      headers.setAuthorization(`Bearer ${authToken}`);
    }
    return headers;
  }

  // The public pages are reached from email links and the bitshala.org
  // embed; the subscriber token in the request is their only credential.
  private getPublicRequestHeaders(): AxiosHeaders {
    return new AxiosHeaders(COMMON_REQUEST_HEADERS);
  }

  // No Content-Type: the browser sets the multipart boundary itself.
  private getMultipartRequestHeaders(): AxiosHeaders {
    const headers = new AxiosHeaders({ 'ngrok-skip-browser-warning': 'true' });
    const authToken = getAuthTokenFromStorage();
    if (authToken) {
      headers.setAuthorization(`Bearer ${authToken}`);
    }
    return headers;
  }

  // =========================
  // Public (subscriber token)
  // =========================

  public listPublicLists = async (): Promise<PublicMailingListResponse[]> => {
    const { data } = await this.request<PublicMailingListResponse[]>({
      headers: this.getPublicRequestHeaders(),
      method: 'GET',
      url: '/newsletter/public/lists',
    });
    return data;
  };

  public subscribe = async (
    body: PublicSubscribeRequest
  ): Promise<PublicSubscribeResponse> => {
    const { data } = await this.request<PublicSubscribeResponse>({
      headers: this.getPublicRequestHeaders(),
      method: 'POST',
      url: '/newsletter/public/subscribe',
      data: body,
    });
    return data;
  };

  public confirmSubscription = async (
    token: string
  ): Promise<ConfirmSubscriptionResponse> => {
    const { data } = await this.request<ConfirmSubscriptionResponse>({
      headers: this.getPublicRequestHeaders(),
      method: 'POST',
      url: '/newsletter/public/confirm',
      data: { token },
    });
    return data;
  };

  public getPreferencesByToken = async (
    token: string
  ): Promise<SubscriberPreferencesResponse> => {
    const { data } = await this.request<SubscriberPreferencesResponse>({
      headers: this.getPublicRequestHeaders(),
      method: 'GET',
      url: '/newsletter/public/preferences',
      params: { token },
    });
    return data;
  };

  public updatePreferencesByToken = async (
    body: PublicUpdatePreferencesRequest
  ): Promise<SubscriberPreferencesResponse> => {
    const { data } = await this.request<SubscriberPreferencesResponse>({
      headers: this.getPublicRequestHeaders(),
      method: 'PUT',
      url: '/newsletter/public/preferences',
      data: body,
    });
    return data;
  };

  public unsubscribe = async (
    body: UnsubscribeRequest
  ): Promise<UnsubscribeResponse> => {
    const { data } = await this.request<UnsubscribeResponse>({
      headers: this.getPublicRequestHeaders(),
      method: 'POST',
      url: '/newsletter/public/unsubscribe',
      data: body,
    });
    return data;
  };

  // =========================
  // Signed-in user
  // =========================

  /** Emails the account's address a link to its preferences page. */
  public requestPreferencesLink =
    async (): Promise<PreferencesLinkResponse> => {
      const { data } = await this.request<PreferencesLinkResponse>({
        headers: this.getRequestHeaders(),
        method: 'POST',
        url: '/newsletter/me/preferences-link',
      });
      return data;
    };

  // =========================
  // Admin: mailing lists
  // =========================

  public listMailingLists = async (
    query: ListMailingListsQuery = {}
  ): Promise<MailingListResponse[]> => {
    const { data } = await this.request<MailingListResponse[]>({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: '/newsletter/admin/lists',
      params: query,
    });
    return data;
  };

  public createMailingList = async (
    body: CreateMailingListRequest
  ): Promise<MailingListResponse> => {
    const { data } = await this.request<MailingListResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: '/newsletter/admin/lists',
      data: body,
    });
    return data;
  };

  public getMailingList = async (id: string): Promise<MailingListResponse> => {
    const { data } = await this.request<MailingListResponse>({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: `/newsletter/admin/lists/${id}`,
    });
    return data;
  };

  public updateMailingList = async (
    id: string,
    body: UpdateMailingListRequest
  ): Promise<MailingListResponse> => {
    const { data } = await this.request<MailingListResponse>({
      headers: this.getRequestHeaders(),
      method: 'PATCH',
      url: `/newsletter/admin/lists/${id}`,
      data: body,
    });
    return data;
  };

  public deleteMailingList = async (id: string): Promise<void> => {
    await this.request<void>({
      headers: this.getRequestHeaders(),
      method: 'DELETE',
      url: `/newsletter/admin/lists/${id}`,
    });
  };

  public listMailingListSubscribers = async (
    id: string,
    query: ListMailingListSubscribersQuery
  ): Promise<PaginatedData<ListSubscriberResponse>> => {
    const { data } = await this.request<PaginatedData<ListSubscriberResponse>>({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: `/newsletter/admin/lists/${id}/subscribers`,
      params: query,
    });
    return data;
  };

  public addMailingListSubscribers = async (
    id: string,
    body: AddSubscribersRequest
  ): Promise<AddSubscribersResponse> => {
    const { data } = await this.request<AddSubscribersResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/lists/${id}/subscribers`,
      data: body,
    });
    return data;
  };

  public addPortalUsersToMailingList = async (
    id: string,
    body: AddPortalUsersRequest
  ): Promise<AddSubscribersResponse> => {
    const { data } = await this.request<AddSubscribersResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/lists/${id}/subscribers/from-users`,
      data: body,
    });
    return data;
  };

  public removeMailingListSubscription = async (
    id: string,
    subscriptionId: string
  ): Promise<void> => {
    await this.request<void>({
      headers: this.getRequestHeaders(),
      method: 'DELETE',
      url: `/newsletter/admin/lists/${id}/subscribers/${subscriptionId}`,
    });
  };

  /**
   * Fetched rather than linked: a plain link sends no session header. The
   * caller names the file — Content-Disposition is not readable cross-origin.
   */
  public exportMailingListSubscribers = async (id: string): Promise<Blob> => {
    const { data } = await this.request<Blob>({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: `/newsletter/admin/lists/${id}/subscribers/export`,
      responseType: 'blob',
    });
    return data;
  };

  // =========================
  // Admin: subscribers
  // =========================

  public listSubscribers = async (
    query: ListSubscribersQuery
  ): Promise<PaginatedData<SubscriberResponse>> => {
    const { data } = await this.request<PaginatedData<SubscriberResponse>>({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: '/newsletter/admin/subscribers',
      params: query,
    });
    return data;
  };

  public updateSubscriber = async (
    id: string,
    body: UpdateSubscriberRequest
  ): Promise<SubscriberResponse> => {
    const { data } = await this.request<SubscriberResponse>({
      headers: this.getRequestHeaders(),
      method: 'PATCH',
      url: `/newsletter/admin/subscribers/${id}`,
      data: body,
    });
    return data;
  };

  public deleteSubscriber = async (id: string): Promise<void> => {
    await this.request<void>({
      headers: this.getRequestHeaders(),
      method: 'DELETE',
      url: `/newsletter/admin/subscribers/${id}`,
    });
  };

  // =========================
  // Admin: newsletters
  // =========================

  public listNewsletters = async (
    query: ListNewslettersQuery
  ): Promise<PaginatedData<NewsletterSummaryResponse>> => {
    const { data } = await this.request<
      PaginatedData<NewsletterSummaryResponse>
    >({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: '/newsletter/admin/newsletters',
      params: query,
    });
    return data;
  };

  public createNewsletter = async (
    body: CreateNewsletterRequest = {}
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: '/newsletter/admin/newsletters',
      data: body,
    });
    return data;
  };

  public getNewsletter = async (
    id: string
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: `/newsletter/admin/newsletters/${id}`,
    });
    return data;
  };

  public updateNewsletter = async (
    id: string,
    body: UpdateNewsletterRequest
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'PATCH',
      url: `/newsletter/admin/newsletters/${id}`,
      data: body,
    });
    return data;
  };

  public deleteNewsletter = async (id: string): Promise<void> => {
    await this.request<void>({
      headers: this.getRequestHeaders(),
      method: 'DELETE',
      url: `/newsletter/admin/newsletters/${id}`,
    });
  };

  public duplicateNewsletter = async (
    id: string
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/newsletters/${id}/duplicate`,
    });
    return data;
  };

  public previewNewsletter = async (
    id: string,
    body: PreviewNewsletterRequest = {}
  ): Promise<NewsletterPreviewResponse> => {
    const { data } = await this.request<NewsletterPreviewResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/newsletters/${id}/preview`,
      data: body,
    });
    return data;
  };

  public getNewsletterAudience = async (
    id: string
  ): Promise<NewsletterAudienceResponse> => {
    const { data } = await this.request<NewsletterAudienceResponse>({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: `/newsletter/admin/newsletters/${id}/audience`,
    });
    return data;
  };

  public sendTestNewsletter = async (
    id: string,
    body: SendTestRequest
  ): Promise<SendTestResponse> => {
    const { data } = await this.request<SendTestResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/newsletters/${id}/test`,
      data: body,
    });
    return data;
  };

  public sendNewsletter = async (
    id: string,
    body: SendNewsletterRequest = {}
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/newsletters/${id}/send`,
      data: body,
    });
    return data;
  };

  public unscheduleNewsletter = async (
    id: string
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/newsletters/${id}/unschedule`,
    });
    return data;
  };

  public cancelNewsletter = async (
    id: string
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/newsletters/${id}/cancel`,
    });
    return data;
  };

  public retryFailedDeliveries = async (
    id: string
  ): Promise<NewsletterDetailResponse> => {
    const { data } = await this.request<NewsletterDetailResponse>({
      headers: this.getRequestHeaders(),
      method: 'POST',
      url: `/newsletter/admin/newsletters/${id}/retry-failed`,
    });
    return data;
  };

  public listNewsletterDeliveries = async (
    id: string,
    query: ListNewsletterDeliveriesQuery
  ): Promise<PaginatedData<NewsletterDeliveryResponse>> => {
    const { data } = await this.request<
      PaginatedData<NewsletterDeliveryResponse>
    >({
      headers: this.getRequestHeaders(),
      method: 'GET',
      url: `/newsletter/admin/newsletters/${id}/deliveries`,
      params: query,
    });
    return data;
  };

  public getNewsletterSettings =
    async (): Promise<NewsletterSettingsResponse> => {
      const { data } = await this.request<NewsletterSettingsResponse>({
        headers: this.getRequestHeaders(),
        method: 'GET',
        url: '/newsletter/admin/settings',
      });
      return data;
    };

  /** png, jpeg, gif or webp, up to 2 MB. */
  public uploadNewsletterImage = async (
    file: File
  ): Promise<NewsletterImageResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await this.request<NewsletterImageResponse>({
      headers: this.getMultipartRequestHeaders(),
      method: 'POST',
      url: '/newsletter/admin/images',
      data: formData,
    });
    return data;
  };
}

const newsletterService = new NewsletterService();
export default newsletterService;
