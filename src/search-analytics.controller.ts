import { Controller, Get, Query } from '@nestjs/common';
import { Ctx, RequestContext, Allow, Permission, ForbiddenError } from '@vendure/core';
import { singleChannel } from './channel-scope';
import { SearchAnalyticsService } from './search-analytics.service';

/**
 * Admin API for search analytics. The storefront just needs to fire
 * `hulo.search(query, resultsCount)` for every executed search;
 * everything else is aggregation over the resulting custom events.
 */
@Controller('ees')
export class SearchAnalyticsController {
    constructor(private readonly service: SearchAnalyticsService) {}

    @Get('search-analytics/top')
    @Allow(Permission.ReadCustomer)
    async top(
        @Ctx() ctx: RequestContext,
        @Query('days') dRaw?: string,
        @Query('channelId') chRaw?: string,
        @Query('limit') lRaw?: string,
    ) {
        const days = Math.min(Math.max(1, parseInt(dRaw || '7', 10) || 7), 365);
        const channelId = singleChannel(ctx as any, chRaw);
        if (channelId == null) throw new ForbiddenError();
        const limit = parseInt(lRaw || '50', 10) || 50;
        const rows = await this.service.topQueries(days, channelId, limit);
        return { days, channelId, items: rows };
    }

    @Get('search-analytics/no-results')
    @Allow(Permission.ReadCustomer)
    async noResults(
        @Ctx() ctx: RequestContext,
        @Query('days') dRaw?: string,
        @Query('channelId') chRaw?: string,
        @Query('limit') lRaw?: string,
    ) {
        const days = Math.min(Math.max(1, parseInt(dRaw || '7', 10) || 7), 365);
        const channelId = singleChannel(ctx as any, chRaw);
        if (channelId == null) throw new ForbiddenError();
        const limit = parseInt(lRaw || '50', 10) || 50;
        const rows = await this.service.zeroResultQueries(days, channelId, limit);
        return { days, channelId, items: rows };
    }

    @Get('search-analytics/conversion')
    @Allow(Permission.ReadCustomer)
    async conversion(
        @Ctx() ctx: RequestContext,
        @Query('days') dRaw?: string,
        @Query('channelId') chRaw?: string,
    ) {
        const days = Math.min(Math.max(1, parseInt(dRaw || '7', 10) || 7), 365);
        const channelId = singleChannel(ctx as any, chRaw);
        if (channelId == null) throw new ForbiddenError();
        const summary = await this.service.searchToAddRate(days, channelId);
        return { days, channelId, ...summary };
    }
}
