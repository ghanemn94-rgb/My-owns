import { Module } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { ProjectFactory } from './project-factory.service';

@Module({ controllers: [PortfolioController], providers: [PortfolioService, ProjectFactory], exports: [PortfolioService, ProjectFactory] })
export class PortfolioModule {}
