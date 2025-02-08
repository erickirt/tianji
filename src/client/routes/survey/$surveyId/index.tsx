import {
  AppRouterOutput,
  defaultErrorHandler,
  defaultSuccessHandler,
  trpc,
} from '@/api/trpc';
import { CommonHeader } from '@/components/CommonHeader';
import { CommonWrapper } from '@/components/CommonWrapper';
import { useCurrentWorkspaceId, useHasAdminPermission } from '@/store/user';
import { routeAuthBeforeLoad } from '@/utils/route';
import { useTranslation } from '@i18next-toolkit/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEvent } from '@/hooks/useEvent';
import { AlertConfirm } from '@/components/AlertConfirm';
import { LuPencil, LuTrash } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createColumnHelper } from '@/components/DataTable';
import { PropsWithChildren, useMemo, useState } from 'react';
import { SurveyDownloadBtn } from '@/components/survey/SurveyDownloadBtn';
import dayjs from 'dayjs';
import { SurveyUsageBtn } from '@/components/survey/SurveyUsageBtn';
import { VirtualizedInfiniteDataTable } from '@/components/VirtualizedInfiniteDataTable';
import { Loading } from '@/components/Loading';
import { TimeEventChart } from '@/components/chart/TimeEventChart';
import { useRegisterCommand } from '@/components/CommandPanel/store';
import { useAIAction } from '@/components/ai/useAIAction';
import { useAIStoreContext } from '@/components/ai/useAIStoreContext';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Empty } from 'antd';
import React from 'react';
import { useGlobalConfig } from '@/hooks/useConfig';
import { DataRender } from '@/components/DataRender';
import { SurveyAIBtn } from '@/components/survey/SurveyAIBtn';

type SurveyResultItem =
  AppRouterOutput['survey']['resultList']['items'][number];

const columnHelper = createColumnHelper<SurveyResultItem>();

export const Route = createFileRoute('/survey/$surveyId/')({
  beforeLoad: routeAuthBeforeLoad,
  component: PageComponent,
});

function PageComponent() {
  const { surveyId } = Route.useParams<{ surveyId: string }>();
  const workspaceId = useCurrentWorkspaceId();
  const { t } = useTranslation();
  const hasAdminPermission = useHasAdminPermission();
  useAIStoreContext({
    type: 'survey',
    surveyId,
  });
  const config = useGlobalConfig();
  const { data: info } = trpc.survey.get.useQuery({
    workspaceId,
    surveyId,
  });
  const { data: count } = trpc.survey.count.useQuery({
    workspaceId,
    surveyId,
  });
  const {
    data: resultList,
    hasNextPage,
    fetchNextPage,
    isFetching,
    isLoading,
    isInitialLoading,
  } = trpc.survey.resultList.useInfiniteQuery(
    {
      workspaceId,
      surveyId,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );
  const { data: surveyStats = [] } = trpc.survey.stats.useQuery({
    workspaceId,
    surveyId,
    startAt: dayjs().subtract(1, 'week').startOf('days').valueOf(),
    endAt: dayjs().endOf('days').valueOf(),
  });
  const deleteMutation = trpc.survey.delete.useMutation({
    onSuccess: defaultSuccessHandler,
    onError: defaultErrorHandler,
  });
  const trpcUtils = trpc.useUtils();
  const navigate = useNavigate();
  const { askAIQuestion } = useAIAction();
  const [selectedIndex, setSelectedIndex] = useState(-1);

  //flatten the array of arrays from the useInfiniteQuery hook
  const flatData = useMemo(
    () => resultList?.pages?.flatMap((page) => page.items) ?? [],
    [resultList]
  );

  const selectedItem = flatData[selectedIndex];

  useRegisterCommand('survey-ai', {
    label: (text) => t('Ask AI about this survey with: {{text}}', { text }),
    enabled: config.enableAI,
    handler: async (input) => {
      askAIQuestion(input);
    },
  });

  const handleDelete = useEvent(async () => {
    await deleteMutation.mutateAsync({ workspaceId, surveyId });
    trpcUtils.survey.all.refetch();
    navigate({
      to: '/survey',
      replace: true,
    });
  });

  const columns = useMemo(() => {
    return [
      columnHelper.accessor('id', {
        header: 'ID',
        size: 230,
        cell: (props) => {
          return (
            <div
              className="cursor-pointer hover:underline hover:decoration-dotted"
              onClick={() => {
                setSelectedIndex(props.row.index);
              }}
            >
              {props.getValue()}
            </div>
          );
        },
      }),
      ...(info?.payload.items.map((item) =>
        columnHelper.accessor(`payload.${item.name}`, {
          header: item.label,
        })
      ) ?? []),
      columnHelper.accessor('createdAt', {
        header: t('Created At'),
        size: 200,
        cell: (props) => dayjs(props.getValue()).format('YYYY-MM-DD HH:mm:ss'),
      }),
    ];
  }, [t, info]);

  return (
    <CommonWrapper
      header={
        <CommonHeader
          title={info?.name ?? ''}
          actions={
            <div className="space-x-2">
              {hasAdminPermission && (
                <Button
                  variant="outline"
                  size="icon"
                  Icon={LuPencil}
                  onClick={() =>
                    navigate({
                      to: '/survey/$surveyId/edit',
                      params: {
                        surveyId,
                      },
                    })
                  }
                />
              )}

              {hasAdminPermission && (
                <AlertConfirm
                  title={t('Confirm to delete this survey?')}
                  description={t(
                    'Survey name: {{name}} | data count: {{num}}',
                    {
                      name: info?.name ?? '',
                      num: count ?? 0,
                    }
                  )}
                  content={t('It will permanently delete the relevant data')}
                  onConfirm={handleDelete}
                >
                  <Button variant="outline" size="icon" Icon={LuTrash} />
                </AlertConfirm>
              )}
            </div>
          }
        />
      }
    >
      <div className="flex h-full flex-col overflow-hidden p-4">
        <div className="mb-4 w-full">
          <Card>
            <CardHeader>
              <CardTitle>{t('Count')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between">
                <div>{count}</div>
                <div className="flex gap-2">
                  {config.enableAI && <SurveyAIBtn surveyId={surveyId} />}
                  <SurveyUsageBtn surveyId={surveyId} />
                  <SurveyDownloadBtn surveyId={surveyId} />
                </div>
              </div>

              <div className="mt-4">
                <TimeEventChart
                  className="h-[240px] w-full"
                  data={surveyStats}
                  unit="day"
                  chartConfig={{
                    count: {
                      label: t('Count'),
                    },
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-2 text-lg font-bold">{t('Preview')}</div>

        <div className="flex-1 overflow-hidden">
          {isInitialLoading ? (
            <Loading />
          ) : (
            <VirtualizedInfiniteDataTable
              selectedIndex={selectedIndex}
              columns={columns}
              data={flatData}
              onFetchNextPage={fetchNextPage}
              isFetching={isFetching}
              isLoading={isLoading}
              hasNextPage={hasNextPage}
            />
          )}
        </div>

        <Sheet
          open={Boolean(selectedItem)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedIndex(-1);
            }
          }}
        >
          <SheetContent className="flex flex-col">
            <SheetHeader>
              <SheetTitle>
                {t('Detail')} {selectedIndex >= 0 && `#${selectedIndex + 1}`}
              </SheetTitle>
            </SheetHeader>

            <ScrollArea className="flex-1 py-4">
              {selectedItem ? (
                <div>
                  <SheetDataSection label="ID">
                    {selectedItem.id}
                  </SheetDataSection>

                  <SheetDataSection label={t('Category')}>
                    {selectedItem.aiCategory ?? (
                      <span className="opacity-40">(null)</span>
                    )}
                  </SheetDataSection>

                  <SheetDataSection label={t('Created At')}>
                    {dayjs(selectedItem.createdAt).format(
                      'YYYY-MM-DD HH:mm:ss'
                    )}
                  </SheetDataSection>

                  {info?.payload.items.map((item) => {
                    return (
                      <SheetDataSection
                        key={item.name}
                        label={item.label ?? item.name}
                      >
                        <DataRender
                          type={item.type}
                          value={selectedItem.payload[item.name]}
                        />
                      </SheetDataSection>
                    );
                  })}
                </div>
              ) : (
                <Empty />
              )}
            </ScrollArea>

            <SheetFooter>
              <Button
                variant="outline"
                disabled={selectedIndex === 0}
                onClick={() => {
                  setSelectedIndex((prev) => prev - 1);
                }}
              >
                {t('Prev')}
              </Button>
              <Button
                disabled={selectedIndex === flatData.length - 1 && !hasNextPage}
                loading={isFetching || isLoading}
                onClick={() => {
                  if (selectedIndex < flatData.length - 1) {
                    setSelectedIndex((prev) => prev + 1);
                  } else {
                    // fetch next page
                    fetchNextPage().then(() => {
                      setSelectedIndex((prev) => prev + 1);
                    });
                  }
                }}
              >
                {t('Next')}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </CommonWrapper>
  );
}

const SheetDataSection: React.FC<PropsWithChildren<{ label: string }>> =
  React.memo((props) => {
    return (
      <div className="mb-2">
        <div className="opacity-60">{props.label}</div>
        <div>{props.children}</div>
      </div>
    );
  });
SheetDataSection.displayName = 'SheetDataSection';
