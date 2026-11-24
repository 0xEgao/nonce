import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APITask } from '@/entities/api-task.entity';
import { Cohort } from '@/entities/cohort.entity';
import { CohortMembership } from '@/entities/cohort-membership.entity';
import { CohortWaitlist } from '@/entities/cohort-waitlist.entity';
import { Fellowship } from '@/entities/fellowship.entity';
import { MailingList } from '@/entities/mailing-list.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { NewsletterDelivery } from '@/entities/newsletter-delivery.entity';
import { NewsletterImage } from '@/entities/newsletter-image.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { User } from '@/entities/user.entity';
import { MailModule } from '@/mail/mail.module';
import { DbTransactionModule } from '@/db-transaction/db-transaction.module';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import { SubscriptionService } from '@/newsletter/subscription.service';
import { MailingListsService } from '@/newsletter/mailing-lists.service';
import { MailingListsController } from '@/newsletter/mailing-lists.controller';
import { SubscribersService } from '@/newsletter/subscribers.service';
import { SubscribersController } from '@/newsletter/subscribers.controller';
import { NewsletterPublicController } from '@/newsletter/newsletter-public.controller';
import { NewsletterMeController } from '@/newsletter/newsletter-me.controller';
import { NewslettersService } from '@/newsletter/newsletters.service';
import { NewslettersController } from '@/newsletter/newsletters.controller';
import { NewsletterRenderService } from '@/newsletter/newsletter-render.service';
import { NewsletterSendService } from '@/newsletter/newsletter-send.service';
import { NewsletterSendStore } from '@/newsletter/newsletter-send.store';
import { NewsletterMailerService } from '@/newsletter/newsletter-mailer.service';
import { NewsletterImagesService } from '@/newsletter/newsletter-images.service';
import { NewsletterImagesController } from '@/newsletter/newsletter-images.controller';
import { NewsletterTrackingService } from '@/newsletter/newsletter-tracking.service';
import { NewsletterTrackingController } from '@/newsletter/newsletter-tracking.controller';

// Imported by TaskProcessorModule for the SEND_NEWSLETTER handler, so this
// module must never import TaskProcessorModule back. Sends are queued by
// writing APITask rows directly.
@Module({
    imports: [
        TypeOrmModule.forFeature([
            MailingList,
            Subscriber,
            MailingListSubscription,
            Newsletter,
            NewsletterDelivery,
            NewsletterImage,
            APITask,
            // Read when copying portal users into a list.
            User,
            Cohort,
            CohortMembership,
            CohortWaitlist,
            Fellowship,
        ]),
        MailModule,
        DbTransactionModule,
    ],
    controllers: [
        NewsletterPublicController,
        NewsletterMeController,
        MailingListsController,
        SubscribersController,
        NewslettersController,
        NewsletterImagesController,
        NewsletterTrackingController,
    ],
    providers: [
        NewsletterUrlService,
        SubscriptionService,
        MailingListsService,
        SubscribersService,
        NewslettersService,
        NewsletterRenderService,
        NewsletterSendService,
        NewsletterSendStore,
        NewsletterMailerService,
        NewsletterImagesService,
        NewsletterTrackingService,
    ],
    exports: [NewsletterSendService, SubscriptionService],
})
export class NewsletterModule {}
