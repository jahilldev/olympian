import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { type LangfuseEvent } from '../langfuse/langfuse.model.js';
import { ChatService } from './chat.service.js';
import {
  CreateChatDto,
  SendMessageDto,
  type ChatSessionDetailDto,
  type ChatSessionSummaryDto,
} from './chat.model.js';

@Controller('chats')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: CreateChatDto): Promise<{ id: string }> {
    return this.chat.createSession({ title: body.title, repoUrl: body.repoUrl });
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(): Promise<ChatSessionSummaryDto[]> {
    return this.chat.listSessions();
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string): Promise<ChatSessionDetailDto> {
    return this.chat.getSession(id);
  }

  @Get(':id/activity')
  @Header('Cache-Control', 'no-store')
  activity(@Param('id') id: string): Promise<Record<string, LangfuseEvent[]>> {
    return this.chat.getActivity(id);
  }

  @Post(':id/messages')
  @HttpCode(202)
  sendMessage(@Param('id') id: string, @Body() body: SendMessageDto): Promise<{ runId: string }> {
    return this.chat.sendMessage(id, body.content, { model: body.model, provider: body.provider });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.chat.deleteSession(id);
  }
}
